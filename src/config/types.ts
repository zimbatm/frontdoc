/**
 * Field types supported by frontdoc.
 */
export type FieldType =
	| "string"
	| "email"
	| "currency"
	| "country"
	| "date"
	| "datetime"
	| "number"
	| "boolean"
	| "enum"
	| "array"
	| "reference";

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
