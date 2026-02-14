import { basename } from "node:path";
import { type Document, parseDocument } from "../document/document.js";
import { BoundVFS } from "../storage/bound-vfs.js";
import type { FileInfo, VFS } from "../storage/vfs.js";

export interface DocumentRecord {
	document: Document;
	path: string;
	info: FileInfo;
}

export type Filter = (record: DocumentRecord) => boolean;

export function byCollection(collectionName: string): Filter {
	return (record) => record.path.split("/")[0] === collectionName;
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
		const { collectionScope, partialID } = splitIDInput(idInput);
		const needle = partialID.toLowerCase();
		const matches: DocumentRecord[] = [];

		const candidates = await this.collectCandidates();
		for (const candidate of candidates) {
			if (collectionScope) {
				const collection = candidate.path.split("/")[0];
				if (collection !== collectionScope) {
					continue;
				}
			}

			const idSegment = extractIDSegment(candidate.path, candidate.isFolder);
			if (!idSegment.toLowerCase().startsWith(needle)) {
				continue;
			}

			const record = await this.parseCandidate(candidate.path, candidate.info, candidate.isFolder);
			const metadataID = String(record.document.metadata.id ?? "").toLowerCase();
			if (matchesMetadataID(metadataID, needle)) {
				matches.push(record);
			}
		}

		if (matches.length === 0) {
			throw new Error(`no document found for id: ${idInput}`);
		}
		if (matches.length > 1) {
			throw new Error(`multiple documents match id: ${idInput}`);
		}
		return matches[0];
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

function splitIDInput(input: string): { collectionScope: string | null; partialID: string } {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		throw new Error("document id must not be empty");
	}

	const slashIndex = trimmed.indexOf("/");
	if (slashIndex === -1) {
		return { collectionScope: null, partialID: trimmed };
	}

	const collectionScope = trimmed.slice(0, slashIndex);
	const partialID = trimmed.slice(slashIndex + 1);
	if (collectionScope.length === 0 || partialID.length === 0) {
		throw new Error(`invalid id format: ${input}`);
	}

	return { collectionScope, partialID };
}

function extractIDSegment(path: string, isFolder: boolean): string {
	const base = isFolder ? basename(path) : basename(path, ".md");
	const dash = base.indexOf("-");
	if (dash === -1) {
		return base;
	}
	return base.slice(0, dash);
}

function isDocumentMarkdownFile(path: string, name: string): boolean {
	if (!path.endsWith(".md")) return false;
	if (name === "README.md") return false;
	if (name === "index.md") return false;
	if (name.startsWith(".")) return false;
	return true;
}

function matchesMetadataID(metadataID: string, needle: string): boolean {
	if (metadataID.length === 0 || needle.length === 0) {
		return false;
	}
	if (metadataID === needle || metadataID.startsWith(needle)) {
		return true;
	}

	// Also match short-id prefixes (last N chars of ULID, where N is 4..16).
	for (let n = 4; n <= 16; n++) {
		if (metadataID.length < n) {
			continue;
		}
		const shortID = metadataID.slice(-n);
		if (shortID.startsWith(needle)) {
			return true;
		}
	}

	return false;
}
