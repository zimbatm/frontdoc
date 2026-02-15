import { describe, expect, test } from "bun:test";
import {
	normalizeFieldInputValue,
	validateFieldDefaultDefinition,
	validateFieldValue,
} from "../../src/config/field-rules.js";

describe("field-rules", () => {
	test("validates boolean values", () => {
		expect(validateFieldValue("boolean", true)).toBeNull();
		expect(validateFieldValue("boolean", false)).toBeNull();
		expect(validateFieldValue("boolean", "true")).toBe("must be boolean");
	});

	test("normalizes boolean input values", () => {
		expect(normalizeFieldInputValue("boolean", true)).toBe(true);
		expect(normalizeFieldInputValue("boolean", "true")).toBe(true);
		expect(normalizeFieldInputValue("boolean", "YES")).toBe(true);
		expect(normalizeFieldInputValue("boolean", "0")).toBe(false);
		expect(() => normalizeFieldInputValue("boolean", "maybe")).toThrow(
			"must be a boolean value",
		);
	});

	test("accepts parseable boolean defaults", () => {
		expect(validateFieldDefaultDefinition("enabled", { type: "boolean", default: true })).toBeNull();
		expect(
			validateFieldDefaultDefinition("enabled", { type: "boolean", default: "false" }),
		).toBeNull();
		expect(
			validateFieldDefaultDefinition("enabled", { type: "boolean", default: "not-bool" }),
		).toContain("boolean");
	});
});
