import { readFile as readHostFile } from "node:fs/promises";
import { basename } from "node:path";
import { resolveCollection } from "../config/collection-resolver.js";
import { validateFieldValue } from "../config/field-rules.js";
import { parseArrayElementType, type CollectionSchema } from "../config/types.js";
import { type Document, displayName, parseDocument } from "../document/document.js";
import { expectedPathForDocument } from "../document/path-policy.js";
import { collectionFromPath } from "../document/path-utils.js";
import { loadDocumentRecordByPath, saveDocument } from "../document/persistence.js";
import { parseSingleWikiLink, parseWikiLinks } from "../document/wiki-link.js";
import { findByIDInRecords } from "../repository/id-lookup.js";
import { byCollection, type DocumentRecord, type Repository } from "../repository/repository.js";
import type { FileInfo } from "../storage/vfs.js";
import { renamePathIfNeeded } from "./path-rename.js";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
	severity: ValidationSeverity;
	path: string;
	code: string;
	message: string;
}

export interface CheckResult {
	issues: ValidationIssue[];
	fixed: number;
	scanned: number;
}

export class ValidationService {
	constructor(
		private readonly schemas: Map<string, CollectionSchema>,
		private readonly aliases: Record<string, string>,
		private readonly ignoreFiles: string[],
		private readonly repository: Repository,
	) {}

	async Check(options: {
		collection?: string;
		fix?: boolean;
		pruneAttachments?: boolean;
	}): Promise<CheckResult> {
		const allRecords = await this.repository.collectAll();
		const records = options.collection
			? allRecords.filter(byCollection(this.resolveCollection(options.collection)))
			: allRecords;
		const resolveByID = (id: string) => findByIDInRecords(allRecords, id);
		const issues: ValidationIssue[] = [];
		let fixed = 0;

		for (const record of records) {
			issues.push(...(await this.validateRecord(record, resolveByID)));
		}

		if (options.fix) {
			const filters = options.collection
				? [byCollection(this.resolveCollection(options.collection))]
				: [];
			const latest = await this.repository.collectAll(...filters);
			for (const record of latest) {
				fixed += await this.fixRecord(record, Boolean(options.pruneAttachments));
			}
		}

		return {
			issues,
			fixed,
			scanned: records.length,
		};
	}

	async ValidateRaw(
		collectionInput: string,
		path: string,
		raw: string,
	): Promise<ValidationIssue[]> {
		const collection = this.resolveCollection(collectionInput);
		const schema = this.schemas.get(collection);
		if (!schema) {
			return [
				{
					severity: "error",
					path,
					code: "collection.unknown",
					message: `unknown collection: ${collectionInput}`,
				},
			];
		}
		let document: Document;
		try {
			document = parseDocument(raw, path, false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return [
				{
					severity: "error",
					path,
					code: "document.parse",
					message,
				},
			];
		}
		const info: FileInfo = {
			name: basename(path),
			path,
			isDirectory: false,
			isFile: true,
			isSymlink: false,
			size: raw.length,
			modifiedAt: new Date(),
		};
		const allRecords = await this.repository.collectAll();
		const resolveByID = (id: string) => findByIDInRecords(allRecords, id);
		return await this.validateRecord({ document, path, info }, resolveByID);
	}

	private async validateRecord(
		record: DocumentRecord,
		resolveByID: (id: string) => DocumentRecord,
	): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];
		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);

		if (!schema) {
			issues.push({
				severity: "error",
				path: record.path,
				code: "collection.unknown",
				message: `document is not in a known collection: ${collection}`,
			});
			return issues;
		}

		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (field.required && !hasValue(record.document.metadata[fieldName])) {
				issues.push({
					severity: "error",
					path: record.path,
					code: "field.required",
					message: `missing required field '${fieldName}'`,
				});
			}
		}

		for (const [fieldName, value] of Object.entries(record.document.metadata)) {
			const field = schema.fields[fieldName];
			if (!field) continue;
			if (!hasValue(value)) continue;
			const err = validateFieldValue(field.type, value, field.enum_values);
			if (err) {
				issues.push({
					severity: "error",
					path: record.path,
					code: `field.${field.type}`,
					message: `${fieldName}: ${err}`,
				});
			}
		}

		for (const [fieldName, targetCollectionRaw] of Object.entries(schema.references)) {
			const value = record.document.metadata[fieldName];
			const isReferenceArray = parseArrayElementType(schema.fields[fieldName]?.type) === "reference";
			const rawValues = isReferenceArray ? (Array.isArray(value) ? value : [value]) : [value];
			const targetCollection = this.resolveCollection(targetCollectionRaw);
			for (const candidate of rawValues) {
				if (candidate === undefined || candidate === null || candidate === "") continue;
				if (typeof candidate !== "string") {
					issues.push({
						severity: "error",
						path: record.path,
						code: "reference.type",
						message: `${fieldName}: reference value must be a string ID`,
					});
					continue;
				}
				let target: DocumentRecord;
				try {
					target = resolveByID(candidate);
				} catch {
					issues.push({
						severity: "error",
						path: record.path,
						code: "reference.missing",
						message: `${fieldName}: referenced document not found: ${candidate}`,
					});
					continue;
				}
				if (collectionFromPath(target.path) !== targetCollection) {
					issues.push({
						severity: "error",
						path: record.path,
						code: "reference.collection",
						message: `${fieldName}: expected collection '${targetCollection}'`,
					});
				}
			}
		}

		if (collection === "templates") {
			const targetRaw = record.document.metadata.for;
			if (typeof targetRaw !== "string" || targetRaw.length === 0) {
				issues.push({
					severity: "error",
					path: record.path,
					code: "template.for.missing",
					message: "template is missing required 'for' field",
				});
			} else {
				const target = this.resolveCollection(targetRaw);
				if (!this.schemas.has(target)) {
					issues.push({
						severity: "error",
						path: record.path,
						code: "template.for.invalid",
						message: `template 'for' references unknown collection: ${targetRaw}`,
					});
				}
			}
		}

		issues.push(...this.validateWikiLinks(record, resolveByID));

		try {
			const expectedPath = expectedPathForDocument(record.document, schema, collection);
			if (expectedPath !== record.path) {
				issues.push({
					severity: "error",
					path: record.path,
					code: "filename.mismatch",
					message: `expected path: ${expectedPath}`,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			issues.push({
				severity: "error",
				path: record.path,
				code: "filename.invalid",
				message: `cannot compute expected filename: ${message}`,
			});
		}

		if (record.document.isFolder) {
			issues.push(...(await this.unreferencedAttachmentIssues(record)));
		}

		return issues;
	}

	private async fixRecord(record: DocumentRecord, pruneAttachments: boolean): Promise<number> {
		let fixed = 0;

		const renamedPath = await this.autoRenamePath(record);
		if (renamedPath !== record.path) {
			fixed++;
		}

		const schema = this.schemas.get(collectionFromPath(renamedPath));
		if (!schema) {
			return fixed;
		}
		const indexFile = schema.index_file ?? "index.md";

		const refreshed = await loadDocumentRecordByPath(
			this.repository.fileSystem(),
			renamedPath,
			indexFile,
		);

		let changedFields = false;
		for (const [fieldName, field] of Object.entries(schema.fields)) {
			if (!field || (field.type !== "currency" && field.type !== "country")) continue;
			const value = refreshed.document.metadata[fieldName];
			if (typeof value !== "string") continue;
			const upper = value.toUpperCase();
			if (upper !== value) {
				refreshed.document.metadata[fieldName] = upper;
				changedFields = true;
			}
		}
		if (changedFields) {
			await saveDocument(this.repository.fileSystem(), refreshed.document, indexFile);
			fixed++;
		}

		const wikiFixed = await this.fixWikiLinkTitles(refreshed);
		if (wikiFixed) {
			fixed++;
		}

		if (pruneAttachments && refreshed.document.isFolder) {
			fixed += await this.pruneUnreferencedAttachments(refreshed);
		}

		if (refreshed.document.isFolder) {
			const after = await loadDocumentRecordByPath(
				this.repository.fileSystem(),
				refreshed.path,
				indexFile,
			);
			const collapsed = await this.collapseFolderIfPossible(after);
			if (collapsed) fixed++;
		}

		return fixed;
	}

	private async autoRenamePath(record: DocumentRecord): Promise<string> {
		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);
		if (!schema) {
			return record.path;
		}
		const expected = expectedPathForDocument(record.document, schema, collection);
		return await renamePathIfNeeded(this.repository.fileSystem(), record.path, expected);
	}

	private async unreferencedAttachmentIssues(record: DocumentRecord): Promise<ValidationIssue[]> {
		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);
		const indexFile = schema?.index_file ?? "index.md";
		const refs = extractAttachmentReferences(record.document.content);
		const entries = await this.repository.fileSystem().readDir(record.path);
		const issues: ValidationIssue[] = [];

		for (const entry of entries) {
			if (entry.name === indexFile) continue;
			if (entry.isDirectory) continue;
			if (!refs.has(entry.name)) {
				issues.push({
					severity: "warning",
					path: `${record.path}/${entry.name}`,
					code: "attachment.unreferenced",
					message: "attachment is not referenced in document content",
				});
			}
		}

		return issues;
	}

	private async pruneUnreferencedAttachments(record: DocumentRecord): Promise<number> {
		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);
		const indexFile = schema?.index_file ?? "index.md";
		const refs = extractAttachmentReferences(record.document.content);
		const entries = await this.repository.fileSystem().readDir(record.path);
		let removed = 0;

		for (const entry of entries) {
			if (entry.name === indexFile) continue;
			if (entry.isDirectory) continue;
			if (!refs.has(entry.name)) {
				await this.repository.fileSystem().remove(`${record.path}/${entry.name}`);
				removed++;
			}
		}

		return removed;
	}

	private async collapseFolderIfPossible(record: DocumentRecord): Promise<boolean> {
		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);
		if (schema?.index_file) {
			return false;
		}
		const entries = await this.repository.fileSystem().readDir(record.path);
		const removableIgnore = new Set(this.ignoreFiles);
		for (const entry of entries) {
			if (entry.name === "index.md") continue;
			if (removableIgnore.has(entry.name)) {
				await this.repository.fileSystem().remove(`${record.path}/${entry.name}`);
				continue;
			}
			return false;
		}

		const finalEntries = await this.repository.fileSystem().readDir(record.path);
		const hasOnlyIndex = finalEntries.every((entry) => entry.name === "index.md");
		if (!hasOnlyIndex) {
			return false;
		}

		const filePath = `${record.path}.md`;
		await this.repository.fileSystem().rename(`${record.path}/index.md`, filePath);
		try {
			await this.repository.fileSystem().remove(record.path);
		} catch {
			await this.repository.fileSystem().removeAll(record.path);
		}
		return true;
	}

	private resolveCollection(input: string): string {
		return resolveCollection(input, this.aliases, this.schemas);
	}

	private validateWikiLinks(
		record: DocumentRecord,
		resolveByID: (id: string) => DocumentRecord,
	): ValidationIssue[] {
		const issues: ValidationIssue[] = [];
		for (const link of parseWikiLinks(record.document.content)) {
			const linkID = link.idToken;
			if (link.invalidReason) {
				issues.push({
					severity: "error",
					path: record.path,
					code: "wiki.invalid",
					message: `invalid wiki link: ${link.invalidReason}`,
				});
				continue;
			}

			let target: DocumentRecord;
			try {
				target = resolveByID(linkID);
			} catch {
				issues.push({
					severity: "error",
					path: record.path,
					code: "wiki.broken",
					message: `broken wiki-style link: [[${link.raw}]]`,
				});
				continue;
			}

			if (link.title) {
				const expected = this.displayNameForRecord(target);
				if (link.title !== expected) {
					issues.push({
						severity: "warning",
						path: record.path,
						code: "wiki.stale-title",
						message: `stale wiki link title for '${linkID}': expected '${expected}'`,
					});
				}
			}
		}
		return issues;
	}

	private async fixWikiLinkTitles(record: DocumentRecord): Promise<boolean> {
		const rebuilt = await this.rebuildWikiTitlesAsync(record.document.content);
		if (!rebuilt.changed) {
			return false;
		}
		record.document.content = rebuilt.content;
		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);
		await saveDocument(this.repository.fileSystem(), record.document, schema?.index_file);
		return true;
	}

	private async rebuildWikiTitlesAsync(
		content: string,
	): Promise<{ changed: boolean; content: string }> {
		const re = /\[\[([^\]]+)\]\]/g;
		let changed = false;
		let out = "";
		let lastIndex = 0;
		let match = re.exec(content);
		while (match !== null) {
			out += content.slice(lastIndex, match.index);
			const inner = match[1].trim();
			const parsed = parseSingleWikiLink(inner);
			if (!parsed || !parsed.title) {
				out += match[0];
			} else {
				try {
					const target = await this.repository.findByID(parsed.idToken);
					const expected = this.displayNameForRecord(target);
					if (expected !== parsed.title) {
						changed = true;
						const prefix = parsed.collectionPrefix ? `${parsed.collectionPrefix}/` : "";
						out += `[[${prefix}${parsed.idToken}:${expected}]]`;
					} else {
						out += match[0];
					}
				} catch {
					out += match[0];
				}
			}
			lastIndex = re.lastIndex;
			match = re.exec(content);
		}
		out += content.slice(lastIndex);
		return { changed, content: out };
	}

	private displayNameForRecord(record: DocumentRecord): string {
		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);
		return displayName(
			record.document,
			schema?.slug,
			schema?.short_id_length ?? 6,
			schema?.title_field,
		);
	}
}

function hasValue(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.length > 0;
	return true;
}

function extractAttachmentReferences(content: string): Set<string> {
	const refs = new Set<string>();
	const patterns = [
		/!?\[[^\]]*\]\(([^)]+)\)/g,
		/^\[[^\]]+\]:\s*(\S+)/gm,
		/<img\s[^>]*src="([^"]+)"/g,
	];

	for (const pattern of patterns) {
		let match = pattern.exec(content);
		while (match !== null) {
			const normalized = normalizeReferenceTarget(match[1]);
			if (normalized.length > 0) refs.add(normalized);
			match = pattern.exec(content);
		}
	}
	return refs;
}

function normalizeReferenceTarget(target: string): string {
	let value = target.trim();
	if (value.startsWith("./")) value = value.slice(2);
	value = value.split("?")[0] ?? value;
	value = value.split("#")[0] ?? value;
	return basename(value);
}

export async function readAttachmentSource(sourcePath: string): Promise<string> {
	return await readHostFile(sourcePath, "utf8");
}
