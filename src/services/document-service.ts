import { readFile as readHostFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { ulid } from "ulidx";
import { resolveAlias } from "../config/alias.js";
import { normalizeDateInput, normalizeDatetimeInput } from "../config/date-input.js";
import type { CollectionSchema } from "../config/types.js";
import {
	buildDocument,
	type Document,
	extractTitleFromContent,
	parseDocument,
	RESERVED_FIELD_PREFIX,
	SYSTEM_FIELDS,
} from "../document/document.js";
import { generateFilename, slugify } from "../document/slug.js";
import { extractPlaceholders, processTemplate } from "../document/template-engine.js";
import {
	byCollection,
	type DocumentRecord,
	type Filter,
	type Repository,
} from "../repository/repository.js";

export interface CreateOptions {
	collection: string;
	fields?: Record<string, unknown>;
	content?: string;
	templateContent?: string;
	overwrite?: boolean;
}

export interface UpdateOptions {
	fields?: Record<string, unknown>;
	unsetFields?: string[];
	content?: string;
}

export interface UpsertResult {
	record: DocumentRecord;
	created: boolean;
}

export interface UpsertBySlugOptions {
	templateContent?: string;
	resolveTemplateContent?: () => Promise<string | undefined>;
}

export class DocumentService {
	constructor(
		private readonly schemas: Map<string, CollectionSchema>,
		private readonly aliases: Record<string, string>,
		private readonly repository: Repository,
	) {}

	ResolveCollection(nameOrAlias: string): string {
		return resolveAlias(nameOrAlias, this.aliases, new Set(this.schemas.keys()));
	}

	async Create(options: CreateOptions): Promise<DocumentRecord> {
		const collection = this.ResolveCollection(options.collection);
		const schema = this.getCollectionSchema(collection);
		const fields = { ...(options.fields ?? {}) };
		assertNoReservedFields(fields, "create");

		injectFieldDefaults(fields, schema);
		ensureRequiredFields(fields, schema, collection);

		const id = ulid().toLowerCase();
		const createdAt = new Date().toISOString();
		fields._id = id;
		fields._created_at = createdAt;

		const content = options.templateContent
			? processTemplate(options.templateContent, buildTemplateValues(fields, schema, id))
			: (options.content ?? "");
		const templateValues = buildTemplateValues(fields, schema, id, content);
		const filename = this.generateFilename(schema, templateValues);
		const path = `${collection}/${filename}`;

		if (!options.overwrite && (await this.repository.fileSystem().exists(path))) {
			throw new Error(`document already exists: ${path}`);
		}

		const doc: Document = {
			path,
			metadata: fields,
			content,
			isFolder: false,
		};
		await this.save(doc);

		const info = await this.repository.fileSystem().stat(path);
		return { document: doc, path, info };
	}

	async ReadByID(id: string): Promise<DocumentRecord> {
		return await this.repository.findByID(id);
	}

	async ReadRawByID(id: string): Promise<string> {
		const record = await this.ReadByID(id);
		const contentPath = record.document.isFolder ? `${record.path}/index.md` : record.path;
		return await this.repository.fileSystem().readFile(contentPath);
	}

	async UpdateByID(id: string, options: UpdateOptions): Promise<DocumentRecord> {
		const record = await this.ReadByID(id);
		const doc = record.document;
		const collection = this.ResolveCollection(doc.path.split("/")[0]);
		const schema = this.getCollectionSchema(collection);

		const fields = options.fields ?? {};
		assertNoReservedFields(fields, "update");
		for (const [key, value] of Object.entries(fields)) {
			doc.metadata[key] = value;
		}
		for (const key of options.unsetFields ?? []) {
			if (key.startsWith(RESERVED_FIELD_PREFIX)) {
				throw new Error(`cannot unset reserved field: ${key}`);
			}
			delete doc.metadata[key];
		}
		ensureRequiredFields(doc.metadata, schema, collection);
		if (options.content !== undefined) {
			doc.content = options.content;
		}

		await this.save(doc);
		const renamedPath = await this.AutoRenamePath(doc.path);
		const updated = await this.loadByPath(renamedPath);
		return updated;
	}

	async DeleteByID(id: string): Promise<void> {
		const record = await this.ReadByID(id);
		if (record.document.isFolder) {
			await this.repository.fileSystem().removeAll(record.path);
			return;
		}
		await this.repository.fileSystem().remove(record.path);
	}

	async AttachFileByID(
		id: string,
		sourcePath: string,
		addReference = true,
		force = false,
	): Promise<string> {
		const record = await this.ReadByID(id);
		let docPath = record.path;

		if (!record.document.isFolder) {
			const folderPath = stripMdExtension(record.path);
			await this.repository.fileSystem().mkdirAll(folderPath);
			await this.repository.fileSystem().rename(record.path, `${folderPath}/index.md`);
			docPath = folderPath;
		}

		const fileName = basename(sourcePath);
		const destPath = `${docPath}/${fileName}`;
		if (!force && (await this.repository.fileSystem().exists(destPath))) {
			throw new Error(`attachment already exists: ${destPath}`);
		}

		const content = await readHostFile(sourcePath, "utf8");
		await this.repository.fileSystem().writeFile(destPath, content);

		if (addReference) {
			const loaded = await this.loadByPath(docPath);
			const suffix = loaded.document.content.endsWith("\n") ? "" : "\n";
			loaded.document.content = `${loaded.document.content}${suffix}\n[${fileName}](${fileName})\n`;
			await this.save(loaded.document);
		}

		return destPath;
	}

	async List(filters: Filter[] = []): Promise<DocumentRecord[]> {
		const records = await this.repository.collectAll(...filters);
		return records.sort((a, b) => a.path.localeCompare(b.path));
	}

	async UpsertBySlug(
		collectionInput: string,
		args: string[],
		options: UpsertBySlugOptions = {},
	): Promise<UpsertResult> {
		const collection = this.ResolveCollection(collectionInput);
		const schema = this.getCollectionSchema(collection);
		const variables = extractTemplateVariables(schema.slug);
		const mapped: Record<string, unknown> = {};

		for (let i = 0; i < Math.min(args.length, variables.length); i++) {
			mapped[variables[i]] = args[i];
		}

		const existing = await this.findByMetadataMatch(collection, mapped);
		if (existing) {
			return { record: existing, created: false };
		}
		const templateContent =
			options.templateContent !== undefined
				? options.templateContent
				: await options.resolveTemplateContent?.();

		const created = await this.Create({
			collection,
			fields: mapped,
			templateContent,
		});
		return { record: created, created: true };
	}

	async AutoRenamePath(path: string): Promise<string> {
		const record = await this.loadByPath(path);
		const collection = record.path.split("/")[0];
		const schema = this.getCollectionSchema(collection);
		const id = String(record.document.metadata._id ?? "");
		const templateValues = buildTemplateValues(record.document.metadata, schema, id, record.document.content);
		const expectedFilePath = `${collection}/${this.generateFilename(schema, templateValues)}`;
		const targetPath = record.document.isFolder
			? stripMdExtension(expectedFilePath)
			: expectedFilePath;

		if (targetPath === record.path) {
			return record.path;
		}

		const parent = dirname(targetPath);
		if (parent !== ".") {
			await this.repository.fileSystem().mkdirAll(parent);
		}
		await this.repository.fileSystem().rename(record.path, targetPath);
		return targetPath;
	}

	private getCollectionSchema(collection: string): CollectionSchema {
		const schema = this.schemas.get(collection);
		if (!schema) {
			throw new Error(`unknown collection: ${collection}`);
		}
		return schema;
	}

	private generateFilename(schema: CollectionSchema, values: Record<string, string>): string {
		const rendered = processTemplate(schema.slug, slugifyTemplateValues(values));
		return generateFilename(rendered);
	}

	private async findByMetadataMatch(
		collection: string,
		fields: Record<string, unknown>,
	): Promise<DocumentRecord | null> {
		const docs = await this.repository.collectAll(byCollection(collection));
		for (const record of docs) {
			let allMatch = true;
			for (const [key, value] of Object.entries(fields)) {
				if (key === "short_id") continue;
				if (key === "_title") {
					const title = extractTitleFromContent(record.document.content);
					if (title !== value) {
						allMatch = false;
						break;
					}
					continue;
				}
				if (record.document.metadata[key] !== value) {
					allMatch = false;
					break;
				}
			}
			if (allMatch) return record;
		}
		return null;
	}

	private async save(doc: Document): Promise<void> {
		const contentPath = doc.isFolder ? `${doc.path}/index.md` : doc.path;
		const parent = dirname(contentPath);
		if (parent !== ".") {
			await this.repository.fileSystem().mkdirAll(parent);
		}
		await this.repository.fileSystem().writeFile(contentPath, buildDocument(doc));
	}

	private async loadByPath(path: string): Promise<DocumentRecord> {
		const isFolder = await this.repository.fileSystem().isDir(path);
		const contentPath = isFolder ? `${path}/index.md` : path;
		const raw = await this.repository.fileSystem().readFile(contentPath);
		const document = parseDocument(raw, path, isFolder);
		const info = await this.repository.fileSystem().stat(path);
		return { document, path, info };
	}
}

function ensureRequiredFields(
	fields: Record<string, unknown>,
	schema: CollectionSchema,
	collection: string,
): void {
	for (const [fieldName, field] of Object.entries(schema.fields)) {
		if (!field.required) continue;
		if (!(fieldName in fields)) {
			throw new Error(`missing required field '${fieldName}' for collection '${collection}'`);
		}
	}
}

function injectFieldDefaults(fields: Record<string, unknown>, schema: CollectionSchema): void {
	for (const [fieldName, field] of Object.entries(schema.fields)) {
		if (fields[fieldName] === undefined && field.default !== undefined) {
			fields[fieldName] = normalizeDefaultFieldValue(field.type, field.default);
		}
	}
}

function normalizeDefaultFieldValue(type: string, value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	if (type === "date") {
		return normalizeDateInput(value);
	}
	if (type === "datetime") {
		return normalizeDatetimeInput(value);
	}
	return value;
}

function buildTemplateValues(
	fields: Record<string, unknown>,
	schema: CollectionSchema,
	id: string,
	content = "",
): Record<string, string> {
	const shortLength = schema.short_id_length ?? 6;
	const shortID = id.length >= shortLength ? id.slice(-shortLength) : id;
	const values: Record<string, string> = {
		short_id: shortID,
		date: resolveDateString(fields.date),
		_title: extractTitleFromContent(content),
	};

	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === null) continue;
		values[key] = String(value);
	}

	return values;
}

function slugifyTemplateValues(values: Record<string, string>): Record<string, string> {
	const slugValues: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		slugValues[key] = slugify(value);
	}
	return slugValues;
}

function resolveDateString(value: unknown): string {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	return new Date().toISOString().slice(0, 10);
}

function extractTemplateVariables(slugTemplate: string): string[] {
	const fields = extractPlaceholders(slugTemplate);
	return fields.filter((f) => f !== "short_id");
}

function stripMdExtension(path: string): string {
	if (path.endsWith(".md")) {
		return path.slice(0, -3);
	}
	return path;
}

function assertNoReservedFields(fields: Record<string, unknown>, operation: string): void {
	for (const key of Object.keys(fields)) {
		if (!key.startsWith(RESERVED_FIELD_PREFIX)) {
			continue;
		}
		if (SYSTEM_FIELDS.has(key)) {
			throw new Error(`cannot ${operation} reserved field: ${key}`);
		}
		throw new Error(`invalid field '${key}': '_' prefix is reserved`);
	}
}
