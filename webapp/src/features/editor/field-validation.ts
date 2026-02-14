import type { UiSchemaField } from "./schema-form-model";

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function validateField(field: UiSchemaField, raw: string): string | null {
	const value = raw.trim();

	if (field.required && value.length === 0) {
		return "Required";
	}
	if (!field.required && value.length === 0) {
		return null;
	}

	switch (field.type) {
		case "email":
			if (!EMAIL_PATTERN.test(value)) return "Must be a valid email";
			break;
		case "currency":
			if (!/^[A-Z]{3}$/.test(value)) return "Use uppercase ISO 4217 code";
			if (field.enumValues.length > 0 && !containsIgnoreCase(field.enumValues, value)) {
				return "Must match one of the allowed values";
			}
			break;
		case "country":
			if (!/^[A-Z]{2}$/.test(value)) return "Use uppercase ISO alpha-2 code";
			if (field.enumValues.length > 0 && !containsIgnoreCase(field.enumValues, value)) {
				return "Must match one of the allowed values";
			}
			break;
		case "date":
			if (!isValidDate(value)) return "Must use YYYY-MM-DD";
			break;
		case "datetime":
			if (!DATETIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
				return "Must use RFC 3339 datetime";
			}
			break;
		case "number": {
			const numeric = Number(value);
			if (Number.isNaN(numeric)) return "Must be a number";
			if (field.min !== undefined && numeric < field.min) return `Must be >= ${field.min}`;
			if (field.max !== undefined && numeric > field.max) return `Must be <= ${field.max}`;
			break;
		}
		case "enum":
			if (!containsIgnoreCase(field.enumValues, value)) {
				return "Must match one of the allowed values";
			}
			break;
		default:
			break;
	}

	if (field.pattern) {
		try {
			if (!new RegExp(field.pattern).test(value)) {
				return "Does not match required pattern";
			}
		} catch {
			// Invalid schema regex should not block editing in the UI.
		}
	}

	return null;
}

export function collectFieldErrors(
	fields: UiSchemaField[],
	values: Record<string, string>,
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const field of fields) {
		const error = validateField(field, values[field.name] ?? "");
		if (error) {
			errors[field.name] = error;
		}
	}
	return errors;
}

function containsIgnoreCase(haystack: string[], needle: string): boolean {
	return haystack.some((entry) => entry.toLowerCase() === needle.toLowerCase());
}

function isValidDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) return false;
	const [yearRaw, monthRaw, dayRaw] = value.split("-");
	const year = Number(yearRaw);
	const month = Number(monthRaw);
	const day = Number(dayRaw);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}
