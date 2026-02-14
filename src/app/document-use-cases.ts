import type { DocumentRecord } from "../repository/repository.js";
import { byCollection, type Filter } from "../repository/repository.js";
import { collectionFromPath as pathCollectionFromPath } from "../document/path-utils.js";
import type { CollectionSchema } from "../config/types.js";
import { normalizeFieldInputValue } from "../config/field-rules.js";
import { extractPlaceholders } from "../document/template-engine.js";
import { SYSTEM_FIELDS } from "../document/document.js";

interface WriteDocumentsPort {
	Create(options: {
		collection: string;
		fields?: Record<string, unknown>;
		content?: string;
		templateContent?: string;
		skipValidation?: boolean;
	}): Promise<DocumentRecord>;
	UpdateByID(
		id: string,
		options: {
			fields?: Record<string, unknown>;
			unsetFields?: string[];
			content?: string;
			skipValidation?: boolean;
		},
	): Promise<DocumentRecord>;
}

interface ListDocumentsPort {
	ResolveCollection(nameOrAlias: string): string;
	List(filters?: Filter[]): Promise<DocumentRecord[]>;
}

interface CreateManagerPort {
	Documents(): WriteDocumentsPort;
}

interface ListManagerPort {
	Documents(): ListDocumentsPort;
	Search(): {
		MatchesQuery(record: DocumentRecord, query: string): boolean;
	};
}

export async function createDocumentUseCase(
	manager: CreateManagerPort,
	options: {
		collection: string;
		fields?: Record<string, unknown>;
		content?: string;
		templateContent?: string;
		skipValidation?: boolean;
	},
): Promise<DocumentRecord> {
	return await manager.Documents().Create(options);
}

export async function updateDocumentUseCase(
	manager: CreateManagerPort,
	options: {
		id: string;
		fields?: Record<string, unknown>;
		unsetFields?: string[];
		content?: string;
		skipValidation?: boolean;
	},
): Promise<DocumentRecord> {
	return await manager.Documents().UpdateByID(options.id, {
		fields: options.fields,
		unsetFields: options.unsetFields,
		content: options.content,
		skipValidation: options.skipValidation,
	});
}

export async function listDocumentsUseCase(
	manager: ListManagerPort,
	options: {
		collection?: string;
		query?: string;
		filters?: Filter[];
		limit?: number;
	},
): Promise<DocumentRecord[]> {
	const filters: Filter[] = [...(options.filters ?? [])];
	if (options.collection) {
		filters.push(byCollection(manager.Documents().ResolveCollection(options.collection)));
	}

	let docs = await manager.Documents().List(filters);
	if (options.query) {
		docs = docs.filter((doc) => manager.Search().MatchesQuery(doc, options.query ?? ""));
	}
	if (options.limit !== undefined) {
		docs = docs.slice(0, Math.max(0, options.limit));
	}
	return docs;
}

export function defaultSlugArgsForSchema(schema: CollectionSchema): string[] {
	const vars = extractPlaceholders(schema.slug).filter((v) => v !== "short_id" && v !== "date");
	const defaults: string[] = [];
	for (const name of vars) {
		const value = schema.fields[name]?.default;
		if (value === undefined || value === null || String(value).length === 0) {
			defaults.push("");
			continue;
		}
		defaults.push(normalizeInputValue(name, String(value), schema));
	}
	return defaults;
}

export function normalizeFieldsForSchema(
	fields: Record<string, unknown>,
	schema: CollectionSchema,
): Record<string, unknown> {
	const normalized: Record<string, unknown> = {};
	for (const [name, raw] of Object.entries(fields)) {
		assertUserFieldInput(name);
		const type = schema.fields[name]?.type;
		if (type === "array") {
			if (Array.isArray(raw)) {
				normalized[name] = raw.map((entry) => String(entry));
				continue;
			}
			const value = String(raw ?? "");
			normalized[name] = value
				.split(/\n|,/g)
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);
			continue;
		}
		normalized[name] = normalizeInputValue(name, String(raw ?? ""), schema);
	}
	return normalized;
}

export function collectionFromPath(path: string): string {
	return pathCollectionFromPath(path);
}

function normalizeInputValue(name: string, value: string, schema: CollectionSchema): string {
	try {
		return normalizeFieldInputValue(schema.fields[name]?.type, value);
	} catch {
		const fieldType = schema.fields[name]?.type;
		if (fieldType === "date") {
			throw new Error(`invalid date input for '${name}': ${value}`);
		}
		if (fieldType === "datetime") {
			throw new Error(`invalid datetime input for '${name}': ${value}`);
		}
		throw new Error(`invalid value for '${name}': ${value}`);
	}
}

function assertUserFieldInput(field: string): void {
	if (SYSTEM_FIELDS.has(field) || field.startsWith("_")) {
		throw new Error(`reserved field prefix '_': ${field}`);
	}
}
