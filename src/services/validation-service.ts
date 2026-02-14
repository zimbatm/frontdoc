import { readFile as readHostFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { resolveAlias } from "../config/alias.js";
import type { CollectionSchema } from "../config/types.js";
import {
	buildDocument,
	type Document,
	displayName,
	extractTitleFromContent,
	parseDocument,
} from "../document/document.js";
import { generateFilename, slugify } from "../document/slug.js";
import { processTemplate } from "../document/template-engine.js";
import { byCollection, type DocumentRecord, type Repository } from "../repository/repository.js";
import type { FileInfo } from "../storage/vfs.js";

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
		return await this.validateRecord({ document, path, info });
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

		issues.push(...(await this.validateWikiLinks(record)));

		try {
			const expectedPath = this.expectedPath(record.document, schema, collection);
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

		const wikiFixed = await this.fixWikiLinkTitles(refreshed);
		if (wikiFixed) {
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

	private async autoRenamePath(record: DocumentRecord): Promise<string> {
		const collection = record.path.split("/")[0] ?? "";
		const schema = this.schemas.get(collection);
		if (!schema) {
			return record.path;
		}
		const expected = this.expectedPath(record.document, schema, collection);
		if (expected === record.path) {
			return record.path;
		}
		const parent = dirname(expected);
		if (parent !== ".") {
			await this.repository.fileSystem().mkdirAll(parent);
		}
		await this.repository.fileSystem().rename(record.path, expected);
		return expected;
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
		const id = String(doc.metadata._id ?? "");
		const shortLength = schema.short_id_length ?? 6;
		const shortID = id.length >= shortLength ? id.slice(-shortLength) : id;
		const values: Record<string, string> = {
			short_id: shortID,
			date:
				typeof doc.metadata.date === "string"
					? doc.metadata.date
					: new Date().toISOString().slice(0, 10),
			_title: extractTitleFromContent(doc.content),
		};
		for (const [key, value] of Object.entries(doc.metadata)) {
			if (value === undefined || value === null) continue;
			values[key] = String(value);
		}
		const rendered = processTemplate(schema.slug, slugifyTemplateValues(values));
		const withShortIDSuffix = appendShortIDSuffix(rendered, values.short_id ?? "");
		const filename = generateFilename(withShortIDSuffix);
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

	private async validateWikiLinks(record: DocumentRecord): Promise<ValidationIssue[]> {
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
				target = await this.repository.findByID(linkID);
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
		await this.save(record.document);
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
		const collection = record.path.split("/")[0];
		const schema = this.schemas.get(collection);
		return displayName(
			record.document,
			schema?.slug,
			schema?.short_id_length ?? 6,
			schema?.title_field,
		);
	}
}

function slugifyTemplateValues(values: Record<string, string>): Record<string, string> {
	const slugValues: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		slugValues[key] = slugify(value);
	}
	return slugValues;
}

function appendShortIDSuffix(renderedSlug: string, shortID: string): string {
	const id = slugify(shortID);
	if (id.length === 0) {
		return renderedSlug;
	}

	const hadMd = renderedSlug.endsWith(".md");
	const withoutExt = hadMd ? renderedSlug.slice(0, -3) : renderedSlug;
	const segments = withoutExt.split("/");
	const last = segments.length > 0 ? segments[segments.length - 1] : "";

	if (last === id || last.endsWith(`-${id}`)) {
		return renderedSlug;
	}

	segments[segments.length - 1] = last.length > 0 ? `${last}-${id}` : id;
	const rebuilt = segments.join("/");
	return hadMd ? `${rebuilt}.md` : rebuilt;
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

interface WikiLink {
	raw: string;
	idToken: string;
	title?: string;
	collectionPrefix?: string;
	invalidReason?: string;
}

function parseWikiLinks(content: string): WikiLink[] {
	const links: WikiLink[] = [];
	const re = /\[\[([^\]]*)\]\]/g;
	let match = re.exec(content);
	while (match !== null) {
		const inner = match[1].trim();
		const parsed = parseSingleWikiLink(inner);
		if (!parsed) {
			links.push({
				raw: inner,
				idToken: "",
				invalidReason: "empty or malformed wiki link",
			});
		} else {
			links.push(parsed);
		}
		match = re.exec(content);
	}
	return links;
}

function parseSingleWikiLink(inner: string): WikiLink | null {
	if (inner.length === 0) return null;
	if (inner.length > 200) {
		return { raw: inner, idToken: "", invalidReason: "wiki link exceeds 200 characters" };
	}
	if (inner.includes("[[") || inner.includes("]]")) {
		return { raw: inner, idToken: "", invalidReason: "nested brackets are not allowed" };
	}

	const [lhs, title] = inner.split(":", 2);
	const rawTarget = lhs.trim();
	if (rawTarget.length === 0) {
		return { raw: inner, idToken: "", invalidReason: "wiki link id is empty" };
	}
	const [collectionPrefix, token] = rawTarget.includes("/")
		? [rawTarget.split("/")[0], rawTarget.split("/").slice(1).join("/")]
		: [undefined, rawTarget];
	const idToken = token.trim();
	if (idToken.length === 0) {
		return { raw: inner, idToken: "", invalidReason: "wiki link id is empty" };
	}
	return {
		raw: inner,
		idToken,
		title: title?.trim() || undefined,
		collectionPrefix,
	};
}
