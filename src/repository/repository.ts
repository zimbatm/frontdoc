import { type Document, parseDocument } from "../document/document.js";
import { collectionFromPath } from "../document/path-utils.js";
import { BoundVFS } from "../storage/bound-vfs.js";
import type { FileInfo, VFS } from "../storage/vfs.js";
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
	constructor(private readonly vfs: VFS) {}

	static fromRoot(rootPath: string): Repository {
		return new Repository(new BoundVFS(rootPath));
	}

	fileSystem(): VFS {
		return this.vfs;
	}

	async collectAll(...filters: Filter[]): Promise<DocumentRecord[]> {
		const records: DocumentRecord[] = [];
		const candidates = await this.collectCandidates();

		for (const candidate of candidates) {
			const record = await this.parseCandidate(candidate.path, candidate.info, candidate.isFolder);
			if (filters.length > 0 && !filters.every((fn) => fn(record))) {
				continue;
			}
			records.push(record);
		}

		return records;
	}

	async findByID(idInput: string): Promise<DocumentRecord> {
		const candidates = await this.collectCandidates();
		const records: DocumentRecord[] = [];
		for (const candidate of candidates) {
			const record = await this.parseCandidate(candidate.path, candidate.info, candidate.isFolder);
			records.push(record);
		}
		return findByIDInRecords(records, idInput);
	}

	private async collectCandidates(): Promise<
		Array<{ path: string; info: FileInfo; isFolder: boolean }>
	> {
		const candidates: Array<{ path: string; info: FileInfo; isFolder: boolean }> = [];

		await this.vfs.walk(".", async (path, info) => {
			if (info.isDirectory) {
				if (await this.vfs.isFile(`${path}/index.md`)) {
					candidates.push({ path, info, isFolder: true });
				}
				return;
			}

			if (info.name === "_schema.yaml") {
				return;
			}

			if (!isDocumentMarkdownFile(path, info.name)) {
				return;
			}

			candidates.push({ path, info, isFolder: false });
		});

		return candidates;
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
}

function isDocumentMarkdownFile(path: string, name: string): boolean {
	if (!path.endsWith(".md")) return false;
	if (name === "README.md") return false;
	if (name === "index.md") return false;
	if (name.startsWith(".")) return false;
	return true;
}
