import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

/**
 * A Document has four properties:
 * - path: file path for file documents, folder path for folder documents
 * - metadata: YAML frontmatter key-value pairs
 * - content: markdown body
 * - isFolder: true if this is a folder document
 */
export interface Document {
	path: string;
	metadata: Record<string, unknown>;
	content: string;
	isFolder: boolean;
}

export const RESERVED_FIELD_PREFIX = "_";
export const SYSTEM_PERSISTED_FIELDS = new Set(["_id", "_created_at"]);
export const SYSTEM_VIRTUAL_FIELDS = new Set(["_title"]);
export const SYSTEM_FIELDS = new Set([...SYSTEM_PERSISTED_FIELDS, ...SYSTEM_VIRTUAL_FIELDS]);

/**
 * Returns the path to the actual content file.
 * For folder docs: path/index.md
 * For file docs: path
 */
export function contentPath(doc: Document): string {
	if (doc.isFolder) {
		return `${doc.path}/index.md`;
	}
	return doc.path;
}

/**
 * Returns the collection name (first path component).
 * For root-level docs, returns the filename itself.
 */
export function getCollection(doc: Document): string {
	const slashIdx = doc.path.indexOf("/");
	if (slashIdx === -1) {
		return doc.path;
	}
	return doc.path.slice(0, slashIdx);
}

/**
 * Returns the document ID from metadata, or empty string.
 */
export function getID(doc: Document): string {
	const id = doc.metadata._id;
	if (typeof id === "string") {
		return id;
	}
	return "";
}

/**
 * Returns the short ID: last N characters of the full ULID.
 * Default length is 6 if not specified.
 */
export function getShortID(doc: Document, length = 6): string {
	const id = getID(doc);
	if (!id || id.length < length) {
		return id;
	}
	return id.slice(-length);
}

/**
 * Returns the display name for a document.
 * Priority: slug template field -> name/title/subject/summary -> filename -> short ID -> "Untitled"
 */
export function displayName(doc: Document, slugTemplate?: string, shortIdLength = 6): string {
	// First try to extract field name from slug template
	if (slugTemplate) {
		const fieldMatch = slugTemplate.match(/\{\{(\w+)\}\}/g);
		if (fieldMatch) {
			for (const match of fieldMatch) {
				const field = match.slice(2, -2).trim();
				if (field !== "short_id" && field !== "date") {
					const val = doc.metadata[field];
					if (typeof val === "string" && val.length > 0) {
						return val;
					}
				}
			}
		}
	}

	// Fallback fields
	for (const field of ["name", "_title", "title", "subject", "summary"]) {
		const val = doc.metadata[field];
		if (typeof val === "string" && val.length > 0) {
			return val;
		}
	}

	const virtualTitle = extractTitleFromContent(doc.content);
	if (virtualTitle.length > 0) {
		return virtualTitle;
	}

	// Filename without extension
	const basename = doc.path.split("/").pop() ?? "";
	if (basename && basename !== "index.md") {
		const name = basename.replace(/\.md$/, "");
		if (name.length > 0) {
			return name;
		}
	}

	// Short ID
	const sid = getShortID(doc, shortIdLength);
	if (sid.length > 0) {
		return sid;
	}

	return "Untitled";
}

/**
 * Build the full document text from metadata and content.
 */
export function buildDocument(doc: Document): string {
	return serializeFrontmatter(doc.metadata, doc.content);
}

/**
 * Parse a raw document string into a Document.
 */
export function parseDocument(raw: string, path: string, isFolder: boolean): Document {
	const { metadata, content } = parseFrontmatter(raw);
	const title = extractTitleFromContent(content);
	if (title.length > 0) {
		metadata._title = title;
	}
	return { path, metadata, content, isFolder };
}

export function extractTitleFromContent(content: string): string {
	const trimmedLeading = content.replace(/^\s+/u, "");
	if (trimmedLeading.length === 0) {
		return "";
	}

	const lines = trimmedLeading.split(/\r?\n/);
	const firstNonEmpty = lines.find((line) => line.trim().length > 0);
	if (!firstNonEmpty) {
		return "";
	}

	const match = firstNonEmpty.match(/^#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
	if (!match) {
		return "";
	}

	return match[1].trim();
}
