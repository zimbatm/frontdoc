import { type Document, parseDocument } from "../document/document.js";
import { collectionFromPath } from "../document/path-utils.js";
import { BoundVFS } from "../storage/bound-vfs.js";
import type { FileInfo, VFS } from "../storage/vfs.js";
import { ulid } from "ulidx";
import { findByIDInRecords } from "./id-lookup.js";

export interface DocumentRecord {
	document: Document;
	path: string;
	info: FileInfo;
}

export type Filter = (record: DocumentRecord) => boolean;

export function byCollection(collectionName: string): Filter {
	return (record) => collectionFromPath(record.path) === collectionName;
}

export function byField(field: string, value: unknown): Filter {
	return (record) => record.document.metadata[field] === value;
}

export function hasField(field: string): Filter {
	return (record) => field in record.document.metadata;
}

export function and(...filters: Filter[]): Filter {
	return (record) => filters.every((fn) => fn(record));
}

export function or(...filters: Filter[]): Filter {
	return (record) => filters.some((fn) => fn(record));
}

export function not(filter: Filter): Filter {
	return (record) => !filter(record);
}

export function excludeTemplatesFilter(): Filter {
	return (record) => !record.path.startsWith("templates/");
}

/**
 * Repository wraps VFS and provides document-specific operations.
 */
export class Repository {
	private static readonly cachedRecordsByRepoID = new Map<string, DocumentRecord[]>();
	private static readonly cacheLoadByRepoID = new Map<string, Promise<DocumentRecord[]>>();
	private readonly repositoryIDValue: string;
	private readonly proxyVfs: VFS;

	constructor(
		private readonly vfs: VFS,
		repositoryID?: string,
	) {
		this.repositoryIDValue = repositoryID ?? ulid().toLowerCase();
		this.proxyVfs = createInvalidatingVFS(vfs, () => this.invalidateCache());
	}

	static fromRoot(rootPath: string): Repository {
		return new Repository(new BoundVFS(rootPath));
	}

	fileSystem(): VFS {
		return this.proxyVfs;
	}

	repositoryID(): string {
		return this.repositoryIDValue;
	}

	async collectAll(...filters: Filter[]): Promise<DocumentRecord[]> {
		if (filters.length === 0) {
			const records = await this.getRecordsSnapshot();
			return records.map(cloneDocumentRecord);
		}
		return await this.collectFiltered(filters);
	}

	async findByID(idInput: string): Promise<DocumentRecord> {
		const records = await this.getRecordsSnapshot();
		return cloneDocumentRecord(findByIDInRecords(records, idInput));
	}

	invalidateCache(): void {
		Repository.cachedRecordsByRepoID.delete(this.repositoryIDValue);
		Repository.cacheLoadByRepoID.delete(this.repositoryIDValue);
	}

	private async collectCandidates(): Promise<
		Array<{ path: string; info: FileInfo; isFolder: boolean }>
	> {
		const candidates: Array<{ path: string; info: FileInfo; isFolder: boolean }> = [];
		const collections = new Set<string>();

		await this.vfs.walk(".", async (path, info) => {
			if (info.isDirectory) {
				if (await this.vfs.isFile(`${path}/index.md`)) {
					candidates.push({ path, info, isFolder: true });
				}
				return;
			}

			if (info.name === "_schema.yaml") {
				const collection = collectionDirFromSchemaPath(path);
				if (collection) collections.add(collection);
				return;
			}

			if (!isDocumentMarkdownFile(path, info.name)) {
				return;
			}

			candidates.push({ path, info, isFolder: false });
		});

		return candidates.filter((candidate) => isInKnownCollection(candidate.path, collections));
	}

	private async parseCandidate(
		path: string,
		info: FileInfo,
		isFolder: boolean,
	): Promise<DocumentRecord> {
		const contentPath = isFolder ? `${path}/index.md` : path;
		const raw = await this.vfs.readFile(contentPath);
		const document = parseDocument(raw, path, isFolder);
		return { document, path, info };
	}

	private async getRecordsSnapshot(): Promise<DocumentRecord[]> {
		const cached = Repository.cachedRecordsByRepoID.get(this.repositoryIDValue);
		if (cached) {
			return cached;
		}

		let load = Repository.cacheLoadByRepoID.get(this.repositoryIDValue);
		if (!load) {
			load = this.loadRecords();
			Repository.cacheLoadByRepoID.set(this.repositoryIDValue, load);
		}

		try {
			const loaded = await load;
			Repository.cachedRecordsByRepoID.set(this.repositoryIDValue, loaded);
			return loaded;
		} finally {
			Repository.cacheLoadByRepoID.delete(this.repositoryIDValue);
		}
	}

	private async loadRecords(): Promise<DocumentRecord[]> {
		const records: DocumentRecord[] = [];
		const candidates = await this.collectCandidates();

		for (const candidate of candidates) {
			const record = await this.parseCandidate(candidate.path, candidate.info, candidate.isFolder);
			records.push(record);
		}
		return records;
	}

	private async collectFiltered(filters: Filter[]): Promise<DocumentRecord[]> {
		const records: DocumentRecord[] = [];
		const candidates = await this.collectCandidates();
		for (const candidate of candidates) {
			const record = await this.parseCandidate(candidate.path, candidate.info, candidate.isFolder);
			if (filters.every((fn) => fn(record))) {
				records.push(cloneDocumentRecord(record));
			}
		}
		return records;
	}
}

function createInvalidatingVFS(vfs: VFS, invalidate: () => void): VFS {
	return {
		root: () => vfs.root(),
		readFile: async (path) => await vfs.readFile(path),
		readFileBytes: async (path) => await vfs.readFileBytes(path),
		writeFile: async (path, data) => {
			await vfs.writeFile(path, data);
			invalidate();
		},
		writeFileBytes: async (path, data) => {
			await vfs.writeFileBytes(path, data);
			invalidate();
		},
		exists: async (path) => await vfs.exists(path),
		isDir: async (path) => await vfs.isDir(path),
		isFile: async (path) => await vfs.isFile(path),
		stat: async (path) => await vfs.stat(path),
		mkdirAll: async (path) => {
			await vfs.mkdirAll(path);
			invalidate();
		},
		remove: async (path) => {
			await vfs.remove(path);
			invalidate();
		},
		removeAll: async (path) => {
			await vfs.removeAll(path);
			invalidate();
		},
		rename: async (oldPath, newPath) => {
			await vfs.rename(oldPath, newPath);
			invalidate();
		},
		walk: async (root, walkFunc) => await vfs.walk(root, walkFunc),
		readDir: async (path) => await vfs.readDir(path),
	};
}

function cloneDocumentRecord(record: DocumentRecord): DocumentRecord {
	return {
		path: record.path,
		document: {
			path: record.document.path,
			metadata: structuredClone(record.document.metadata),
			content: record.document.content,
			isFolder: record.document.isFolder,
		},
		info: {
			name: record.info.name,
			path: record.info.path,
			isDirectory: record.info.isDirectory,
			isFile: record.info.isFile,
			isSymlink: record.info.isSymlink,
			size: record.info.size,
			modifiedAt: new Date(record.info.modifiedAt),
		},
	};
}

function isDocumentMarkdownFile(path: string, name: string): boolean {
	if (!path.endsWith(".md")) return false;
	if (name === "README.md") return false;
	if (name === "index.md") return false;
	if (name.startsWith(".")) return false;
	return true;
}

function collectionDirFromSchemaPath(path: string): string | null {
	if (!path.endsWith("/_schema.yaml")) return null;
	const parts = path.split("/");
	if (parts.length !== 2) return null;
	return parts[0];
}

function isInKnownCollection(path: string, collections: Set<string>): boolean {
	const [first] = path.split("/");
	if (!first) return false;
	return collections.has(first);
}
