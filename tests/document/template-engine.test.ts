import { describe, expect, test } from "bun:test";
import { extractPlaceholders, processTemplate } from "../../src/document/template-engine.js";

describe("processTemplate", () => {
	test("replaces simple field placeholders", () => {
		const result = processTemplate("Hello {{name}}", { name: "World" });
		expect(result).toBe("Hello World");
	});

	test("replaces multiple placeholders", () => {
		const result = processTemplate("{{name}}-{{short_id}}", {
			short_id: "9g5fav",
			name: "Acme Corp",
		});
		expect(result).toBe("Acme Corp-9g5fav");
	});

	test("applies year filter", () => {
		const result = processTemplate("{{date | year}}", { date: "2024-03-15" });
		expect(result).toBe("2024");
	});

	test("applies month filter", () => {
		const result = processTemplate("{{date | month}}", { date: "2024-03-15" });
		expect(result).toBe("03");
	});

	test("applies day filter", () => {
		const result = processTemplate("{{date | day}}", { date: "2024-03-15" });
		expect(result).toBe("15");
	});

	test("applies upper filter", () => {
		const result = processTemplate("{{name | upper}}", { name: "hello" });
		expect(result).toBe("HELLO");
	});

	test("applies lower filter", () => {
		const result = processTemplate("{{name | lower}}", { name: "HELLO" });
		expect(result).toBe("hello");
	});

	test("handles escaped braces", () => {
		const result = processTemplate("\\{{not a placeholder}}", {});
		expect(result).toBe("{{not a placeholder}}");
	});

	test("throws on missing field", () => {
		expect(() => processTemplate("{{missing}}", {})).toThrow("missing template field: missing");
	});

	test("throws on unknown filter", () => {
		expect(() => processTemplate("{{name | bogus}}", { name: "test" })).toThrow(
			"unknown template filter: bogus",
		);
	});

	test("throws on unclosed placeholder", () => {
		expect(() => processTemplate("{{unclosed", {})).toThrow("unclosed template placeholder");
	});

	test("handles template with no placeholders", () => {
		const result = processTemplate("no placeholders here", {});
		expect(result).toBe("no placeholders here");
	});

	test("handles subdirectory slug template", () => {
		const result = processTemplate("{{date | year}}/{{name}}-{{short_id}}", {
			date: "2024-03-15",
			short_id: "9g5fav",
			name: "Acme Corp",
		});
		expect(result).toBe("2024/Acme Corp-9g5fav");
	});
});

describe("extractPlaceholders", () => {
	test("extracts simple fields", () => {
		const fields = extractPlaceholders("{{name}}-{{short_id}}");
		expect(fields).toEqual(["name", "short_id"]);
	});

	test("extracts fields with filters", () => {
		const fields = extractPlaceholders("{{date | year}}/{{name | lower}}");
		expect(fields).toEqual(["date", "name"]);
	});

	test("deduplicates fields", () => {
		const fields = extractPlaceholders("{{name}} and {{name}}");
		expect(fields).toEqual(["name"]);
	});

	test("returns empty for no placeholders", () => {
		const fields = extractPlaceholders("no placeholders");
		expect(fields).toEqual([]);
	});

	test("ignores escaped placeholders", () => {
		const fields = extractPlaceholders("\\{{escaped}} {{real}}");
		expect(fields).toEqual(["real"]);
	});
});
