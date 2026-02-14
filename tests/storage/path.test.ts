import { describe, expect, test } from "bun:test";
import { normalizePath } from "../../src/storage/path.js";

describe("normalizePath", () => {
	test("normalizes simple paths", () => {
		expect(normalizePath("foo/bar")).toBe("foo/bar");
		expect(normalizePath("foo//bar")).toBe("foo/bar");
		expect(normalizePath("foo/./bar")).toBe("foo/bar");
	});

	test("removes trailing slashes", () => {
		expect(normalizePath("foo/bar/")).toBe("foo/bar");
	});

	test("rejects empty paths", () => {
		expect(() => normalizePath("")).toThrow("path must not be empty");
		expect(() => normalizePath("  ")).toThrow("path must not be empty");
	});

	test("rejects absolute paths", () => {
		expect(() => normalizePath("/foo/bar")).toThrow("absolute paths are not allowed");
	});

	test("rejects parent traversal", () => {
		expect(() => normalizePath("..")).toThrow("parent traversal");
		expect(() => normalizePath("../foo")).toThrow("parent traversal");
		expect(() => normalizePath("foo/../../bar")).toThrow("parent traversal");
		expect(() => normalizePath("foo/../../../bar")).toThrow("parent traversal");
	});

	test("allows single-segment paths", () => {
		expect(normalizePath("foo")).toBe("foo");
		expect(normalizePath("_schema.yaml")).toBe("_schema.yaml");
	});
});
