import { readFile as readHostFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { ulid } from "ulidx";
import { resolveCollection } from "../config/collection-resolver.js";
import { normalizeDateInput, normalizeDatetimeInput } from "../config/date-input.js";
import type { CollectionSchema } from "../config/types.js";
import {
	buildTemplateValues,
	generateDocumentFilename,
} from "../document/path-policy.js";
import {
	buildDocument,
	type Document,
	contentPath,
	extractTitleFromContent,
	parseDocument,
	RESERVED_FIELD_PREFIX,
	SYSTEM_FIELDS,
} from "../document/document.js";
import { extractPlaceholders, processTemplate } from "../document/template-engine.js";
import { collectionFromPath } from "../document/path-utils.js";
import {
	byCollection,
	type DocumentRecord,
	type Filter,
	type Repository,
} from "../repository/repository.js";
import type { TemplateRecord, TemplateService } from "./template-service.js";
import type { ValidationIssue, ValidationService } from "./validation-service.js";

export interface CreateOptions {
	collection: string;
	fields?: Record<string, unknown>;
	content?: string;
	templateContent?: string;
	overwrite?: boolean;
	skipValidation?: boolean;
}

export interface UpdateOptions {
	fields?: Record<string, unknown>;
	unsetFields?: string[];
	content?: string;
	skipValidation?: boolean;
}

export interface UpsertResult {
	record: DocumentRecord;
	created: boolean;
}

export interface UpsertBySlugOptions {
	templateContent?: string;
	resolveTemplateContent?: () => Promise<string | undefined>;
}

export interface PlanBySlugResult {
	record: DocumentRecord | null;
	draft: Document | null;
}

export class DocumentService {
	constructor(
		private readonly schemas: Map<string, CollectionSchema>,
		private readonly aliases: Record<string, string>,
		private readonly repository: Repository,
		private readonly validationService?: ValidationService,
		private readonly templateService?: TemplateService,
	) {}

	ResolveCollection(nameOrAlias: string): string {
		return resolveCollection(nameOrAlias, this.aliases, this.schemas);
	}

	async Create(options: CreateOptions): Promise<DocumentRecord> {
		const doc = this.prepareNewDocument(
			options.collection,
			options.fields ?? {},
			options.content,
			options.templateContent,
		);
		const path = doc.path;
		const collection = collectionFromPath(path);

		if (!options.overwrite && (await this.repository.fileSystem().exists(path))) {
			throw new Error(`document already exists: ${path}`);
		}

		if (!options.skipValidation && this.validationService) {
			await this.assertNoValidationErrors(collection, path, buildDocument(doc));
		}

		await this.save(doc);

		const info = await this.repository.fileSystem().stat(path);
		return { document: doc, path, info };
	}

	async ReadByID(id: string): Promise<DocumentRecord> {
		return await this.repository.findByID(id);
	}

	async ReadRawByID(id: string): Promise<string> {
		const record = await this.ReadByID(id);
		return await this.repository.fileSystem().readFile(contentPath(record.document));
	}

	async UpdateByID(id: string, options: UpdateOptions): Promise<DocumentRecord> {
		const record = await this.ReadByID(id);
		const doc = record.document;
		const collection = this.ResolveCollection(collectionFromPath(doc.path));
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
		if (!options.skipValidation && this.validationService) {
			await this.assertNoValidationErrors(
				collectionFromPath(updated.path),
				updated.path,
				buildDocument(updated.document),
			);
		}
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

	async PlanBySlug(
		collectionInput: string,
		args: string[],
		options: UpsertBySlugOptions = {},
	): Promise<PlanBySlugResult> {
		const collection = this.ResolveCollection(collectionInput);
		const schema = this.getCollectionSchema(collection);
		const variables = extractTemplateVariables(schema.slug);
		const mapped: Record<string, unknown> = {};

		for (let i = 0; i < Math.min(args.length, variables.length); i++) {
			mapped[variables[i]] = args[i];
		}

		const existing = await this.findByMetadataMatch(collection, mapped);
		if (existing) {
			return { record: existing, draft: null };
		}
		const templateContent = await this.resolveTemplateContent(collection, options);
		const draft = this.prepareNewDocument(collection, mapped, undefined, templateContent);
		return { record: null, draft };
	}

	async UpsertBySlug(
		collectionInput: string,
		args: string[],
		options: UpsertBySlugOptions = {},
	): Promise<UpsertResult> {
		const planned = await this.PlanBySlug(collectionInput, args, options);
		if (planned.record) {
			return { record: planned.record, created: false };
		}
		if (!planned.draft) {
			throw new Error("missing draft plan");
		}
		if (await this.repository.fileSystem().exists(planned.draft.path)) {
			throw new Error(`document already exists: ${planned.draft.path}`);
		}
		await this.save(planned.draft);
		const info = await this.repository.fileSystem().stat(planned.draft.path);
		return { record: { document: planned.draft, path: planned.draft.path, info }, created: true };
	}

	async AutoRenamePath(path: string): Promise<string> {
		const record = await this.loadByPath(path);
		const collection = collectionFromPath(record.path);
		const schema = this.getCollectionSchema(collection);
		const id = String(record.document.metadata._id ?? "");
		const templateValues = buildTemplateValues(record.document.metadata, schema, id, record.document.content);
		const expectedFilePath = `${collection}/${generateDocumentFilename(schema, templateValues)}`;
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

	private prepareNewDocument(
		collectionInput: string,
		inputFields: Record<string, unknown>,
		content: string | undefined,
		templateContent: string | undefined,
	): Document {
		const collection = this.ResolveCollection(collectionInput);
		const schema = this.getCollectionSchema(collection);
		const fields = { ...inputFields };
		assertNoReservedFields(fields, "create");

		injectFieldDefaults(fields, schema);
		ensureRequiredFields(fields, schema, collection);

		const id = ulid().toLowerCase();
		const createdAt = new Date().toISOString();
		fields._id = id;
		fields._created_at = createdAt;

		const initialContent = templateContent
			? processTemplate(templateContent, buildTemplateValues(fields, schema, id))
			: (content ?? "");
		const templateValues = buildTemplateValues(fields, schema, id, initialContent);
		const filename = generateDocumentFilename(schema, templateValues);

		return {
			path: `${collection}/${filename}`,
			metadata: fields,
			content: initialContent,
			isFolder: false,
		};
	}

	private async resolveTemplateContent(
		collection: string,
		options: UpsertBySlugOptions,
	): Promise<string | undefined> {
		if (options.templateContent !== undefined) {
			return options.templateContent;
		}
		const resolved = await options.resolveTemplateContent?.();
		if (resolved !== undefined) {
			return resolved;
		}
		if (!this.templateService) {
			return undefined;
		}
		const templates: TemplateRecord[] = await this.templateService.GetTemplatesForCollection(
			collection,
		);
		if (templates.length === 1) {
			return templates[0].content;
		}
		return undefined;
	}

	private async assertNoValidationErrors(
		collection: string,
		path: string,
		raw: string,
	): Promise<void> {
		if (!this.validationService) {
			return;
		}
		const issues = await this.validationService.ValidateRaw(collection, path, raw);
		const errors = issues.filter((issue: ValidationIssue) => issue.severity === "error");
		if (errors.length === 0) {
			return;
		}
		const details = errors.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
		throw new Error(`validation failed: ${details}`);
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
