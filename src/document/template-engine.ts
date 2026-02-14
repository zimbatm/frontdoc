/**
 * Template engine for processing `{{field}}` and `{{field | filter}}` placeholders.
 */

export type TemplateValues = Record<string, string>;

/**
 * Process a template string by replacing `{{field}}` and `{{field | filter}}` placeholders.
 * Use `\{{` to produce literal braces.
 */
export function processTemplate(template: string, values: TemplateValues): string {
	let result = "";
	let i = 0;

	while (i < template.length) {
		// Handle escaped braces
		if (template[i] === "\\" && template.startsWith("{{", i + 1)) {
			result += "{{";
			i += 3; // skip \{{
			continue;
		}

		// Look for placeholder start
		if (template.startsWith("{{", i)) {
			const endIdx = template.indexOf("}}", i + 2);
			if (endIdx === -1) {
				throw new Error("unclosed template placeholder");
			}

			const placeholder = template.slice(i + 2, endIdx).trim();
			const { field, filter } = parsePlaceholder(placeholder);

			if (!(field in values)) {
				throw new Error(`missing template field: ${field}`);
			}

			let value = values[field];
			if (filter) {
				value = applyFilter(value, filter);
			}

			result += value;
			i = endIdx + 2;
			continue;
		}

		result += template[i];
		i++;
	}

	return result;
}

/**
 * Extract all placeholder field names from a template string.
 */
export function extractPlaceholders(template: string): string[] {
	const fields: string[] = [];
	const re = /(?<!\\)\{\{(.+?)\}\}/g;
	let match = re.exec(template);
	while (match !== null) {
		const { field } = parsePlaceholder(match[1].trim());
		if (!fields.includes(field)) {
			fields.push(field);
		}
		match = re.exec(template);
	}

	return fields;
}

function parsePlaceholder(placeholder: string): { field: string; filter?: string } {
	const pipeIdx = placeholder.indexOf("|");
	if (pipeIdx === -1) {
		return { field: placeholder.trim() };
	}
	return {
		field: placeholder.slice(0, pipeIdx).trim(),
		filter: placeholder.slice(pipeIdx + 1).trim(),
	};
}

function applyFilter(value: string, filter: string): string {
	switch (filter) {
		case "year":
			return extractDatePart(value, 0, 4);
		case "month":
			return extractDatePart(value, 5, 7);
		case "day":
			return extractDatePart(value, 8, 10);
		case "upper":
			return value.toUpperCase();
		case "lower":
			return value.toLowerCase();
		default:
			throw new Error(`unknown template filter: ${filter}`);
	}
}

function extractDatePart(value: string, start: number, end: number): string {
	// Expects YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ format
	if (value.length < end) {
		throw new Error(`cannot extract date part from value: ${value}`);
	}
	return value.slice(start, end);
}
