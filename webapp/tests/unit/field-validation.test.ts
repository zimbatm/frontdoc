import { describe, expect, test } from "vitest";
import { collectFieldErrors, validateField } from "../../src/features/editor/field-validation";
import type { UiSchemaField } from "../../src/features/editor/schema-form-model";

const baseField: UiSchemaField = {
	name: "value",
	type: "string",
	required: false,
	description: "",
	enumValues: [],
	weight: 0,
	knownField: true,
};

describe("field validation", () => {
	test("enforces required fields", () => {
		expect(validateField({ ...baseField, required: true }, "")).toBe("Required");
	});

	test("validates number min/max", () => {
		const field = { ...baseField, type: "number" as const, min: 1, max: 10 };
		expect(validateField(field, "0")).toBe("Must be >= 1");
		expect(validateField(field, "20")).toBe("Must be <= 10");
		expect(validateField(field, "5")).toBeNull();
	});

	test("validates enum values case-insensitively", () => {
		const field = { ...baseField, type: "enum" as const, enumValues: ["Open", "Closed"] };
		expect(validateField(field, "open")).toBeNull();
		expect(validateField(field, "invalid")).toBe("Must match one of the allowed values");
	});

	test("collects errors for a schema field set", () => {
		const fields: UiSchemaField[] = [
			{ ...baseField, name: "email", type: "email", required: true },
			{ ...baseField, name: "start", type: "date" },
		];
		const errors = collectFieldErrors(fields, { email: "nope", start: "2026-02-30" });
		expect(errors.email).toBe("Must be a valid email");
		expect(errors.start).toBe("Must use YYYY-MM-DD");
	});
});
