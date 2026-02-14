import { readFile as readHostFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { resolveAlias } from "../config/alias.js";
import type { CollectionSchema } from "../config/types.js";
import { buildDocument, type Document, parseDocument } from "../document/document.js";
import { generateFilename } from "../document/slug.js";
import { processTemplate } from "../document/template-engine.js";
import { byCollection, type DocumentRecord, type Repository } from "../repository/repository.js";
import type { DocumentService } from "./document-service.js";

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
		private readonly documents: DocumentService,
	) {}

	async Check(options: {
		collection?: string;
		fix?: boolean;
		pruneAttachments?: boolean;
	}): Promise<CheckResult> {
		const filters = [];
		if (options.collection) {
			filters.push(byCollection(this.resolveCollection(options.collection)));
		}
		const records = await this.repository.collectAll(...filters);
		const issues: ValidationIssue[] = [];
		let fixed = 0;

		for (const record of records) {
			issues.push(...(await this.validateRecord(record)));
		}

		if (options.fix) {
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

	private async validateRecord(record: DocumentRecord): Promise<ValidationIssue[]> {
		const issues: ValidationIssue[] = [];
		const collection = record.path.split("/")[0];
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
			const err = validateByType(field.type, value, field.enum_values);
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
			if (typeof value !== "string" || value.length === 0) continue;
			const targetCollection = this.resolveCollection(targetCollectionRaw);
			let target: DocumentRecord;
			try {
				target = await this.repository.findByID(value);
			} catch {
				issues.push({
					severity: "error",
					path: record.path,
					code: "reference.missing",
					message: `${fieldName}: referenced document not found: ${value}`,
				});
				continue;
			}
			if (target.path.split("/")[0] !== targetCollection) {
				issues.push({
					severity: "error",
					path: record.path,
					code: "reference.collection",
					message: `${fieldName}: expected collection '${targetCollection}'`,
				});
			}
		}

		const expectedPath = this.expectedPath(record.document, schema, collection);
		if (expectedPath !== record.path) {
			issues.push({
				severity: "error",
				path: record.path,
				code: "filename.mismatch",
				message: `expected path: ${expectedPath}`,
			});
		}

		if (record.document.isFolder) {
			issues.push(...(await this.unreferencedAttachmentIssues(record)));
		}

		return issues;
	}

	private async fixRecord(record: DocumentRecord, pruneAttachments: boolean): Promise<number> {
		let fixed = 0;

		const renamedPath = await this.documents.AutoRenamePath(record.path);
		if (renamedPath !== record.path) {
			fixed++;
		}

		const refreshed = await this.loadByPath(renamedPath);
		const schema = this.schemas.get(refreshed.path.split("/")[0]);
		if (!schema) {
			return fixed;
		}

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
			await this.save(refreshed.document);
			fixed++;
		}

		if (pruneAttachments && refreshed.document.isFolder) {
			fixed += await this.pruneUnreferencedAttachments(refreshed);
		}

		if (refreshed.document.isFolder) {
			const after = await this.loadByPath(refreshed.path);
			const collapsed = await this.collapseFolderIfPossible(after);
			if (collapsed) fixed++;
		}

		return fixed;
	}

	private async unreferencedAttachmentIssues(record: DocumentRecord): Promise<ValidationIssue[]> {
		const refs = extractAttachmentReferences(record.document.content);
		const entries = await this.repository.fileSystem().readDir(record.path);
		const issues: ValidationIssue[] = [];

		for (const entry of entries) {
			if (entry.name === "index.md") continue;
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
		const refs = extractAttachmentReferences(record.document.content);
		const entries = await this.repository.fileSystem().readDir(record.path);
		let removed = 0;

		for (const entry of entries) {
			if (entry.name === "index.md") continue;
			if (entry.isDirectory) continue;
			if (!refs.has(entry.name)) {
				await this.repository.fileSystem().remove(`${record.path}/${entry.name}`);
				removed++;
			}
		}

		return removed;
	}

	private async collapseFolderIfPossible(record: DocumentRecord): Promise<boolean> {
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

	private expectedPath(doc: Document, schema: CollectionSchema, collection: string): string {
		const id = String(doc.metadata.id ?? "");
		const shortLength = schema.short_id_length ?? 6;
		const shortID = id.length >= shortLength ? id.slice(-shortLength) : id;
		const values: Record<string, string> = {
			short_id: shortID,
			date:
				typeof doc.metadata.date === "string"
					? doc.metadata.date
					: new Date().toISOString().slice(0, 10),
		};
		for (const [key, value] of Object.entries(doc.metadata)) {
			if (value === undefined || value === null) continue;
			values[key] = String(value);
		}
		const rendered = processTemplate(schema.slug, values);
		const filename = generateFilename(rendered);
		const path = `${collection}/${filename}`;
		return doc.isFolder ? stripMd(path) : path;
	}

	private resolveCollection(input: string): string {
		return resolveAlias(input, this.aliases, new Set(this.schemas.keys()));
	}

	private async loadByPath(path: string): Promise<DocumentRecord> {
		const isFolder = await this.repository.fileSystem().isDir(path);
		const contentPath = isFolder ? `${path}/index.md` : path;
		const raw = await this.repository.fileSystem().readFile(contentPath);
		const document = parseDocument(raw, path, isFolder);
		const info = await this.repository.fileSystem().stat(path);
		return { document, path, info };
	}

	private async save(doc: Document): Promise<void> {
		const contentPath = doc.isFolder ? `${doc.path}/index.md` : doc.path;
		const parent = dirname(contentPath);
		if (parent !== ".") {
			await this.repository.fileSystem().mkdirAll(parent);
		}
		await this.repository.fileSystem().writeFile(contentPath, buildDocument(doc));
	}
}

function hasValue(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.length > 0;
	return true;
}

function validateByType(type: string, value: unknown, enumValues?: string[]): string | null {
	switch (type) {
		case "email":
			return typeof value === "string" &&
				/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)
				? null
				: "invalid email format";
		case "currency":
			if (typeof value !== "string") return "must be a string";
			if (!/^[A-Z]{3}$/.test(value)) return "must be uppercase ISO 4217 code";
			if (enumValues && enumValues.length > 0 && !enumValues.includes(value)) {
				return "must be one of enum_values";
			}
			return null;
		case "country":
			if (typeof value !== "string") return "must be a string";
			if (!/^[A-Z]{2}$/.test(value)) return "must be uppercase ISO 3166-1 alpha-2 code";
			if (enumValues && enumValues.length > 0 && !enumValues.includes(value)) {
				return "must be one of enum_values";
			}
			return null;
		case "date":
			return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
				? null
				: "must be YYYY-MM-DD";
		case "datetime":
			if (typeof value !== "string") return "must be RFC3339 string";
			return Number.isNaN(Date.parse(value)) ? "must be RFC3339 string" : null;
		case "number":
			if (typeof value === "number") return null;
			if (typeof value === "string" && value.length > 0 && !Number.isNaN(Number(value)))
				return null;
			return "must be numeric";
		case "enum":
			if (typeof value !== "string") return "must be a string";
			if (!enumValues || enumValues.length === 0) return "enum_values must be configured";
			return enumValues.some((v) => v.toLowerCase() === value.toLowerCase())
				? null
				: "must be one of enum_values";
		case "array":
			return Array.isArray(value) ? null : "must be an array";
		default:
			return null;
	}
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

function stripMd(path: string): string {
	return path.endsWith(".md") ? path.slice(0, -3) : path;
}

export async function readAttachmentSource(sourcePath: string): Promise<string> {
	return await readHostFile(sourcePath, "utf8");
}
