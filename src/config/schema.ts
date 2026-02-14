import { parse, stringify } from "yaml";
import type { VFS } from "../storage/vfs.js";
import { validateFieldDefaultDefinition } from "./field-rules.js";
import type { CollectionSchema, FieldDefinition, FieldType } from "./types.js";

/**
 * Parse _schema.yaml content into a CollectionSchema.
 */
export function parseCollectionSchema(content: string): CollectionSchema {
	const data = parse(content) as Record<string, unknown> | null;
	if (!data || typeof data !== "object") {
		throw new Error("invalid _schema.yaml: empty or not an object");
	}

	if (typeof data.slug !== "string") {
		throw new Error("invalid _schema.yaml: missing required 'slug' field");
	}

	const fields: Record<string, FieldDefinition> = {};
	if (data.fields && typeof data.fields === "object") {
		for (const [name, def] of Object.entries(data.fields as Record<string, unknown>)) {
			assertUserFieldName(name, "field");
			fields[name] = parseFieldDefinition(def);
		}
	}

	const references: Record<string, string> = {};
	if (data.references && typeof data.references === "object") {
		for (const [name, target] of Object.entries(data.references as Record<string, unknown>)) {
			assertUserFieldName(name, "reference");
			if (typeof target === "string") {
				references[name] = target;
			}
		}
	}

	const shortIDLength = typeof data.short_id_length === "number" ? data.short_id_length : undefined;
	if (shortIDLength !== undefined && (shortIDLength < 4 || shortIDLength > 16)) {
		throw new Error("invalid _schema.yaml: short_id_length must be between 4 and 16");
	}
	const titleField = typeof data.title_field === "string" ? data.title_field.trim() : undefined;
	if (titleField !== undefined && titleField.length === 0) {
		throw new Error("invalid _schema.yaml: title_field must not be empty");
	}

	for (const [name, def] of Object.entries(fields)) {
		const err = validateFieldDefaultDefinition(name, def);
		if (err) {
			throw new Error(`invalid _schema.yaml: ${err}`);
		}
	}

	return {
		slug: data.slug,
		short_id_length: shortIDLength,
		title_field: titleField,
		fields,
		references,
	};
}

function parseFieldDefinition(raw: unknown): FieldDefinition {
	if (!raw || typeof raw !== "object") {
		return { type: "string" };
	}
	const def = raw as Record<string, unknown>;
	const result: FieldDefinition = {
		type: (typeof def.type === "string" ? def.type : "string") as FieldType,
	};
	if (typeof def.required === "boolean") result.required = def.required;
	if (typeof def.description === "string") result.description = def.description;
	if (def.default !== undefined) result.default = def.default;
	if (Array.isArray(def.enum_values)) {
		result.enum_values = def.enum_values.filter((v): v is string => typeof v === "string");
	}
	if (typeof def.pattern === "string") result.pattern = def.pattern;
	if (typeof def.min === "number") result.min = def.min;
	if (typeof def.max === "number") result.max = def.max;
	if (typeof def.weight === "number") result.weight = def.weight;
	return result;
}

function assertUserFieldName(name: string, kind: "field" | "reference"): void {
	if (name.startsWith("_")) {
		throw new Error(`invalid _schema.yaml: ${kind} '${name}' uses reserved '_' prefix`);
	}
}

/**
 * Serialize a CollectionSchema to _schema.yaml content.
 */
export function serializeCollectionSchema(schema: CollectionSchema): string {
	const data: Record<string, unknown> = { slug: schema.slug };
	if (schema.short_id_length !== undefined) {
		data.short_id_length = schema.short_id_length;
	}
	if (schema.title_field !== undefined) {
		data.title_field = schema.title_field;
	}
	if (Object.keys(schema.fields).length > 0) {
		data.fields = serializeFields(schema.fields);
	}
	if (Object.keys(schema.references).length > 0) {
		data.references = schema.references;
	}
	return stringify(data, { lineWidth: 0 });
}

function serializeFields(fields: Record<string, FieldDefinition>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [name, def] of Object.entries(fields)) {
		const field: Record<string, unknown> = { type: def.type };
		if (def.required) field.required = def.required;
		if (def.description) field.description = def.description;
		if (def.default !== undefined) field.default = def.default;
		if (def.enum_values && def.enum_values.length > 0) field.enum_values = def.enum_values;
		if (def.pattern) field.pattern = def.pattern;
		if (def.min !== undefined) field.min = def.min;
		if (def.max !== undefined) field.max = def.max;
		if (def.weight !== undefined) field.weight = def.weight;
		result[name] = field;
	}
	return result;
}

/**
 * Discover collections by scanning top-level directories for _schema.yaml.
 */
export async function discoverCollections(vfs: VFS): Promise<Map<string, CollectionSchema>> {
	const collections = new Map<string, CollectionSchema>();
	const entries = await vfs.readDir(".");
	for (const entry of entries) {
		if (!entry.isDirectory) continue;
		const schemaPath = `${entry.name}/_schema.yaml`;
		if (await vfs.exists(schemaPath)) {
			const content = await vfs.readFile(schemaPath);
			const schema = parseCollectionSchema(content);
			collections.set(entry.name, schema);
		}
	}
	return collections;
}

/**
 * Generate a default slug template for a collection based on its fields.
 */
export function generateDefaultSlug(fields: Record<string, FieldDefinition>): string {
	for (const name of ["title", "name", "subject"]) {
		if (name in fields) {
			return `{{${name}}}`;
		}
	}
	return "{{short_id}}";
}
