export type SchemaFieldType =
	| "string"
	| "email"
	| "currency"
	| "country"
	| "date"
	| "datetime"
	| "number"
	| "enum"
	| "array"
	| "reference";

export interface SchemaFieldDefinition {
	type: SchemaFieldType;
	required?: boolean;
	description?: string;
	default?: unknown;
	enum_values?: string[];
	pattern?: string;
	min?: number;
	max?: number;
	weight?: number;
}

export interface CollectionSchemaSnapshot {
	fields?: Record<string, SchemaFieldDefinition>;
}

export interface UiSchemaField {
	name: string;
	type: SchemaFieldType | "string";
	required: boolean;
	description: string;
	enumValues: string[];
	pattern?: string;
	min?: number;
	max?: number;
	weight: number;
	knownField: boolean;
}

export function buildUiSchemaFields(
	schema: CollectionSchemaSnapshot | null | undefined,
	metadata: Record<string, unknown>,
): UiSchemaField[] {
	const fields = schema?.fields ?? {};
	const out: UiSchemaField[] = [];

	for (const [name, field] of Object.entries(fields)) {
		out.push({
			name,
			type: field.type,
			required: Boolean(field.required),
			description: field.description ?? "",
			enumValues: field.enum_values ?? [],
			pattern: field.pattern,
			min: field.min,
			max: field.max,
			weight: field.weight ?? 0,
			knownField: true,
		});
	}

	for (const key of Object.keys(metadata)) {
		if (key.startsWith("_")) continue;
		if (fields[key]) continue;
		out.push({
			name: key,
			type: "string",
			required: false,
			description: "",
			enumValues: [],
			weight: -1,
			knownField: false,
		});
	}

	return out.sort((a, b) => {
		if (a.weight !== b.weight) return b.weight - a.weight;
		return a.name.localeCompare(b.name);
	});
}

export function formStringValue(type: UiSchemaField["type"], value: unknown): string {
	if (value === null || value === undefined) return "";
	if (type === "array" && Array.isArray(value)) {
		return value.map((entry) => String(entry)).join("\n");
	}
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry)).join(", ");
	}
	return String(value);
}

export function payloadValue(type: UiSchemaField["type"], raw: string): unknown {
	if (type !== "array") {
		return raw;
	}
	return raw
		.split(/\n|,/g)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}
