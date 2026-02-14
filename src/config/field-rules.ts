import { normalizeDateInput, normalizeDatetimeInput } from "./date-input.js";
import type { FieldDefinition, FieldType } from "./types.js";

export function validateFieldValue(
	type: FieldType,
	value: unknown,
	enumValues?: string[],
): string | null {
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
			if (typeof value === "string" && value.length > 0 && !Number.isNaN(Number(value))) {
				return null;
			}
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

export function validateFieldDefaultDefinition(name: string, def: FieldDefinition): string | null {
	if (def.default === undefined) return null;
	const value = def.default;

	switch (def.type) {
		case "email":
			if (
				typeof value !== "string" ||
				!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)
			) {
				return `field '${name}' default must be a valid email`;
			}
			return null;
		case "currency":
			if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
				return `field '${name}' default must be an uppercase ISO 4217 code`;
			}
			return null;
		case "country":
			if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) {
				return `field '${name}' default must be an uppercase ISO 3166-1 alpha-2 code`;
			}
			return null;
		case "date":
			if (typeof value !== "string") {
				return `field '${name}' default must be YYYY-MM-DD or supported shorthand`;
			}
			try {
				normalizeDateInput(value);
			} catch {
				return `field '${name}' default must be YYYY-MM-DD or supported shorthand`;
			}
			return null;
		case "datetime":
			if (typeof value !== "string") {
				return `field '${name}' default must be RFC3339 datetime or supported date shorthand`;
			}
			try {
				normalizeDatetimeInput(value);
			} catch {
				return `field '${name}' default must be RFC3339 datetime or supported date shorthand`;
			}
			return null;
		case "number":
			if (
				typeof value !== "number" &&
				!(typeof value === "string" && value.length > 0 && !Number.isNaN(Number(value)))
			) {
				return `field '${name}' default must be numeric`;
			}
			return null;
		case "enum":
			if (typeof value !== "string") {
				return `field '${name}' default must be a string from enum_values`;
			}
			if (!def.enum_values || def.enum_values.length === 0) {
				return `field '${name}' default requires enum_values`;
			}
			if (!def.enum_values.some((v) => v.toLowerCase() === value.toLowerCase())) {
				return `field '${name}' default must be one of enum_values`;
			}
			return null;
		case "array":
			return Array.isArray(value) ? null : `field '${name}' default must be an array`;
		default:
			return typeof value === "string" ? null : `field '${name}' default must be a string`;
	}
}

export function normalizeFieldInputValue(type: FieldType | undefined, value: string): string {
	if (type === "date") {
		return normalizeDateInput(value);
	}
	if (type === "datetime") {
		return normalizeDatetimeInput(value);
	}
	return value;
}

export function normalizeFieldDefaultValue(type: FieldType, value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	return normalizeFieldInputValue(type, value);
}
