import { stringify } from "yaml";
import { generateAlias, resolveAlias } from "../config/alias.js";
import { serializeRepoConfig } from "../config/repo-config.js";
import { generateDefaultSlug, serializeCollectionSchema } from "../config/schema.js";
import {
	COLLECTION_NAME_PATTERN,
	type CollectionSchema,
	type FieldDefinition,
	RESERVED_COLLECTION_NAMES,
	type RepoConfig,
} from "../config/types.js";
import { buildDocument } from "../document/document.js";
import { byCollection, type Repository } from "../repository/repository.js";

export interface SchemaShowResult {
	aliases: Record<string, string>;
	collections: Record<string, CollectionSchema>;
}

export interface SchemaReadResult {
	collection: string;
	alias: string | null;
	schema: CollectionSchema;
}

export interface AddCollectionOptions {
	name: string;
	alias?: string;
	slug?: string;
	fields?: Record<string, FieldDefinition>;
	references?: Record<string, string>;
	shortIdLength?: number;
}

export interface UpdateCollectionOptions {
	name: string;
	alias?: string;
	slug?: string;
	shortIdLength?: number;
}

export interface RemoveCollectionOptions {
	name: string;
	removeDocuments?: boolean;
	force?: boolean;
}

export class SchemaService {
	constructor(
		private readonly schemas: Map<string, CollectionSchema>,
		private readonly repoConfig: RepoConfig,
		private readonly repository: Repository,
	) {}

	show(): SchemaShowResult {
		const collections: Record<string, CollectionSchema> = {};
		for (const [name, schema] of [...this.schemas.entries()].sort(([a], [b]) =>
			a.localeCompare(b),
		)) {
			collections[name] = schema;
		}

		return {
			aliases: { ...this.repoConfig.aliases },
			collections,
		};
	}

	read(nameOrAlias: string): SchemaReadResult {
		const collection = this.ResolveCollectionAlias(nameOrAlias);
		const schema = this.schemas.get(collection);
		if (!schema) {
			throw new Error(`collection not found: ${nameOrAlias}`);
		}

		return {
			collection,
			alias: findAliasForCollection(collection, this.repoConfig.aliases),
			schema,
		};
	}

	ResolveCollectionAlias(nameOrAlias: string): string {
		return resolveAlias(nameOrAlias, this.repoConfig.aliases, new Set(this.schemas.keys()));
	}

	async AddCollection(options: AddCollectionOptions): Promise<SchemaReadResult> {
		const name = options.name.trim();
		validateCollectionName(name);
		if (this.schemas.has(name)) {
			throw new Error(`collection already exists: ${name}`);
		}

		const fields = { ...(options.fields ?? {}) };
		const references = { ...(options.references ?? {}) };
		const slug = options.slug?.trim() || generateDefaultSlug(fields);
		const alias = (options.alias?.trim() || generateAlias(name)).toLowerCase();
		this.ensureAliasAvailable(alias, name);

		const schema: CollectionSchema = {
			slug,
			fields,
			references,
		};
		if (options.shortIdLength !== undefined) {
			schema.short_id_length = options.shortIdLength;
		}

		await this.repository.fileSystem().mkdirAll(name);
		await this.repository
			.fileSystem()
			.writeFile(`${name}/_schema.yaml`, serializeCollectionSchema(schema));

		this.schemas.set(name, schema);
		this.repoConfig.aliases[alias] = name;
		await this.persistRepoConfig();

		return this.read(name);
	}

	async UpdateCollection(options: UpdateCollectionOptions): Promise<SchemaReadResult> {
		const currentName = this.ResolveCollectionAlias(options.name);
		const schema = this.schemas.get(currentName);
		if (!schema) {
			throw new Error(`collection not found: ${options.name}`);
		}

		if (options.slug !== undefined) {
			schema.slug = options.slug;
		}
		if (options.shortIdLength !== undefined) {
			schema.short_id_length = options.shortIdLength;
		}
		await this.persistSchema(currentName);

		if (options.alias !== undefined) {
			const alias = options.alias.trim().toLowerCase();
			this.ensureAliasAvailable(alias, currentName);
			for (const [k, v] of Object.entries(this.repoConfig.aliases)) {
				if (v === currentName) {
					delete this.repoConfig.aliases[k];
				}
			}
			this.repoConfig.aliases[alias] = currentName;
			await this.persistRepoConfig();
		}

		return this.read(currentName);
	}

	async RenameCollection(oldNameOrAlias: string, newName: string): Promise<SchemaReadResult> {
		const oldName = this.ResolveCollectionAlias(oldNameOrAlias);
		validateCollectionName(newName);
		if (!this.schemas.has(oldName)) {
			throw new Error(`collection not found: ${oldNameOrAlias}`);
		}
		if (this.schemas.has(newName)) {
			throw new Error(`collection already exists: ${newName}`);
		}

		await this.repository.fileSystem().rename(oldName, newName);
		const schema = this.schemas.get(oldName);
		if (!schema) {
			throw new Error(`collection not found: ${oldName}`);
		}
		this.schemas.delete(oldName);
		this.schemas.set(newName, schema);

		for (const [collection, sch] of this.schemas.entries()) {
			let changed = false;
			for (const [field, target] of Object.entries(sch.references)) {
				if (target === oldName) {
					sch.references[field] = newName;
					changed = true;
				}
			}
			if (changed || collection === newName) {
				await this.persistSchema(collection);
			}
		}

		for (const [alias, target] of Object.entries(this.repoConfig.aliases)) {
			if (target === oldName) {
				this.repoConfig.aliases[alias] = newName;
			}
		}
		await this.persistRepoConfig();

		await this.updateTemplateForFields(oldName, newName);
		return this.read(newName);
	}

	async RemoveCollection(options: RemoveCollectionOptions): Promise<void> {
		const name = this.ResolveCollectionAlias(options.name);
		if (!this.schemas.has(name)) {
			throw new Error(`collection not found: ${options.name}`);
		}

		const docs = await this.repository.collectAll(byCollection(name));
		if (docs.length > 0 && !options.removeDocuments && !options.force) {
			throw new Error(`collection '${name}' has ${docs.length} documents (use --remove-documents)`);
		}

		if (options.removeDocuments) {
			for (const doc of docs) {
				if (doc.document.isFolder) {
					await this.repository.fileSystem().removeAll(doc.path);
				} else {
					await this.repository.fileSystem().remove(doc.path);
				}
			}
			await this.removeTemplatesForCollection(name);
		}

		if (await this.repository.fileSystem().exists(`${name}/_schema.yaml`)) {
			await this.repository.fileSystem().remove(`${name}/_schema.yaml`);
		}

		const entries = await this.repository
			.fileSystem()
			.readDir(name)
			.catch(() => []);
		if (entries.length === 0) {
			await this.repository
				.fileSystem()
				.remove(name)
				.catch(() => {});
		}

		this.schemas.delete(name);
		for (const [alias, target] of Object.entries(this.repoConfig.aliases)) {
			if (target === name) {
				delete this.repoConfig.aliases[alias];
			}
		}
		await this.persistRepoConfig();
	}

	async AddFieldToCollection(
		collectionNameOrAlias: string,
		fieldName: string,
		field: FieldDefinition,
		referenceTarget?: string,
	): Promise<SchemaReadResult> {
		const collection = this.ResolveCollectionAlias(collectionNameOrAlias);
		assertSchemaFieldName(fieldName);
		const schema = this.requireSchema(collection);
		if (schema.fields[fieldName]) {
			throw new Error(`field already exists: ${fieldName}`);
		}
		schema.fields[fieldName] = field;
		if (field.type === "reference" && referenceTarget) {
			schema.references[fieldName] = this.ResolveCollectionAlias(referenceTarget);
		}
		await this.persistSchema(collection);
		return this.read(collection);
	}

	async UpdateFieldInCollection(
		collectionNameOrAlias: string,
		fieldName: string,
		update: Partial<FieldDefinition>,
	): Promise<SchemaReadResult> {
		const collection = this.ResolveCollectionAlias(collectionNameOrAlias);
		assertSchemaFieldName(fieldName);
		const schema = this.requireSchema(collection);
		const current = schema.fields[fieldName];
		if (!current) {
			throw new Error(`field not found: ${fieldName}`);
		}
		schema.fields[fieldName] = { ...current, ...removeUndefined(update) };
		await this.persistSchema(collection);
		return this.read(collection);
	}

	async RemoveFieldFromCollection(
		collectionNameOrAlias: string,
		fieldName: string,
	): Promise<SchemaReadResult> {
		const collection = this.ResolveCollectionAlias(collectionNameOrAlias);
		assertSchemaFieldName(fieldName);
		const schema = this.requireSchema(collection);
		if (!schema.fields[fieldName]) {
			throw new Error(`field not found: ${fieldName}`);
		}
		delete schema.fields[fieldName];
		delete schema.references[fieldName];
		await this.persistSchema(collection);
		return this.read(collection);
	}

	private requireSchema(collection: string): CollectionSchema {
		const schema = this.schemas.get(collection);
		if (!schema) {
			throw new Error(`collection not found: ${collection}`);
		}
		return schema;
	}

	private ensureAliasAvailable(alias: string, targetCollection: string): void {
		if (alias in this.repoConfig.aliases && this.repoConfig.aliases[alias] !== targetCollection) {
			throw new Error(`alias already in use: ${alias}`);
		}
		if (this.schemas.has(alias) && alias !== targetCollection) {
			throw new Error(`alias collides with collection name: ${alias}`);
		}
	}

	private async persistSchema(collection: string): Promise<void> {
		const schema = this.schemas.get(collection);
		if (!schema) {
			throw new Error(`collection not found: ${collection}`);
		}
		await this.repository
			.fileSystem()
			.writeFile(`${collection}/_schema.yaml`, serializeCollectionSchema(schema));
	}

	private async persistRepoConfig(): Promise<void> {
		await this.repository
			.fileSystem()
			.writeFile("tmdoc.yaml", serializeRepoConfig(this.repoConfig));
	}

	private async removeTemplatesForCollection(collection: string): Promise<void> {
		const templates = await this.repository.collectAll(byCollection("templates"));
		for (const template of templates) {
			const target = String(template.document.metadata.for ?? "");
			if (target === collection) {
				if (template.document.isFolder) {
					await this.repository.fileSystem().removeAll(template.path);
				} else {
					await this.repository.fileSystem().remove(template.path);
				}
			}
		}
	}

	private async updateTemplateForFields(oldName: string, newName: string): Promise<void> {
		const templates = await this.repository.collectAll(byCollection("templates"));
		for (const template of templates) {
			if (String(template.document.metadata.for ?? "") !== oldName) continue;
			template.document.metadata.for = newName;
			const contentPath = template.document.isFolder ? `${template.path}/index.md` : template.path;
			await this.repository.fileSystem().writeFile(contentPath, buildDocument(template.document));
		}
	}
}

export function formatSchemaShowText(result: SchemaShowResult): string {
	const lines: string[] = [];
	lines.push("Aliases:");
	const aliasEntries = Object.entries(result.aliases).sort(([a], [b]) => a.localeCompare(b));
	if (aliasEntries.length === 0) {
		lines.push("  (none)");
	} else {
		for (const [alias, target] of aliasEntries) {
			lines.push(`  ${alias}: ${target}`);
		}
	}

	lines.push("");
	lines.push("Collections:");
	const collectionEntries = Object.entries(result.collections);
	if (collectionEntries.length === 0) {
		lines.push("  (none)");
	} else {
		for (const [name, schema] of collectionEntries) {
			lines.push(`  ${name}: slug=${schema.slug}`);
		}
	}

	return lines.join("\n");
}

export function formatSchemaReadText(result: SchemaReadResult): string {
	const lines: string[] = [];
	lines.push(`Collection: ${result.collection}`);
	lines.push(`Alias: ${result.alias ?? "(none)"}`);
	lines.push("Schema:");
	for (const line of stringify(result.schema, { lineWidth: 0 }).trimEnd().split("\n")) {
		lines.push(`  ${line}`);
	}
	return lines.join("\n");
}

function findAliasForCollection(
	collection: string,
	aliases: Record<string, string>,
): string | null {
	for (const [alias, target] of Object.entries(aliases)) {
		if (target === collection) {
			return alias;
		}
	}
	return null;
}

function validateCollectionName(name: string): void {
	if (name.length === 0) {
		throw new Error("collection name must not be empty");
	}
	if (!COLLECTION_NAME_PATTERN.test(name)) {
		throw new Error("collection name may only contain letters, digits, underscore, dash");
	}
	if (RESERVED_COLLECTION_NAMES.includes(name)) {
		throw new Error(`reserved collection name: ${name}`);
	}
}

function removeUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function assertSchemaFieldName(name: string): void {
	if (name.startsWith("_")) {
		throw new Error(`invalid field name: '${name}' uses reserved '_' prefix`);
	}
}
