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

	test("validates typed array values", () => {
		expect(validateFieldValue("array<number>", [1, "2", 3.5])).toBeNull();
		expect(validateFieldValue("array<number>", [1, "x"])).toContain("array item");
		expect(validateFieldValue("array<boolean>", [true, false])).toBeNull();
		expect(validateFieldValue("array<boolean>", [true, "false"])).toContain("array item");
	});

	test("validates typed array defaults", () => {
		expect(
			validateFieldDefaultDefinition("scores", { type: "array<number>", default: [1, "2"] }),
		).toBeNull();
		expect(
			validateFieldDefaultDefinition("scores", { type: "array<number>", default: ["x"] }),
		).toContain("default item");
	});

	test("validates url values and defaults", () => {
		expect(validateFieldValue("url", "https://example.com/path")).toBeNull();
		expect(validateFieldValue("url", "not-a-url")).toContain("URL");
		expect(
			validateFieldDefaultDefinition("homepage", {
				type: "url",
				default: "https://frontdoc.dev/docs",
			}),
		).toBeNull();
		expect(
			validateFieldDefaultDefinition("homepage", { type: "url", default: "relative/path" }),
		).toContain("URL");
	});
});
