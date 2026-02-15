/**
 * Field types supported by frontdoc.
 */
export type ScalarFieldType =
	| "string"
	| "email"
	| "currency"
	| "country"
	| "date"
	| "datetime"
	| "number"
	| "boolean"
	| "url"
	| "enum"
	| "reference";

export type FieldType = ScalarFieldType | "array" | `array<${ScalarFieldType}>`;

const SCALAR_FIELD_TYPES: ReadonlySet<string> = new Set([
	"string",
	"email",
	"currency",
	"country",
	"date",
	"datetime",
	"number",
	"boolean",
	"url",
	"enum",
	"reference",
]);

/**
 * Parse array element type from `array<T>` declarations.
 */
export function parseArrayElementType(type: string | undefined): ScalarFieldType | undefined {
	if (!type || !type.startsWith("array<") || !type.endsWith(">")) {
		return undefined;
	}
	const inner = type.slice("array<".length, -1).trim();
	if (!SCALAR_FIELD_TYPES.has(inner)) {
		return undefined;
	}
	return inner as ScalarFieldType;
}

/**
 * Whether a field type is array-like (`array` or `array<T>`).
 */
export function isArrayFieldType(type: string | undefined): boolean {
	return type === "array" || parseArrayElementType(type) !== undefined;
}

/**
 * Field definition within a collection schema.
 */
export interface FieldDefinition {
	type: FieldType;
	required?: boolean;
	description?: string;
	default?: unknown;
	enum_values?: string[];
	pattern?: string;
	min?: number;
	max?: number;
	weight?: number;
}

/**
 * Collection schema from `_schema.yaml`.
 */
export interface CollectionSchema {
	slug: string;
	short_id_length?: number;
	title_field?: string;
	index_file?: string;
	fields: Record<string, FieldDefinition>;
	references: Record<string, string>;
}

/**
 * Repository configuration from `frontdoc.yaml`.
 */
export interface RepoConfig {
	repository_id?: string;
	aliases: Record<string, string>;
	ignore: string[];
	/** Any unknown keys preserved from file. */
	extra: Record<string, unknown>;
}

/**
 * Default ignore list.
 */
export const DEFAULT_IGNORE = [".DS_Store", "Thumbs.db"];

/**
 * Reserved collection names that cannot be used.
 */
export const RESERVED_COLLECTION_NAMES = ["all", "none", "default"];

/**
 * Collection name validation pattern.
 */
export const COLLECTION_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
