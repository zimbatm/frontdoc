import { describe, expect, test } from "bun:test";
import { generateFilename, slugify } from "../../src/document/slug.js";

describe("slugify", () => {
	test("lowercases and replaces non-alphanumeric with hyphens", () => {
		expect(slugify("Acme Corporation")).toBe("acme-corporation");
	});

	test("collapses consecutive hyphens", () => {
		expect(slugify("hello---world")).toBe("hello-world");
	});

	test("trims leading and trailing hyphens", () => {
		expect(slugify("-hello-")).toBe("hello");
	});

	test("handles empty string", () => {
		expect(slugify("")).toBe("");
	});

	test("preserves forward slashes", () => {
		expect(slugify("2024/My Post")).toBe("2024/my-post");
	});

	test("handles special characters", () => {
		expect(slugify("Hello, World! (test)")).toBe("hello-world-test");
	});

	test("handles numbers", () => {
		expect(slugify("Item 42")).toBe("item-42");
	});
});

describe("generateFilename", () => {
	test("slugifies and appends .md", () => {
		expect(generateFilename("9g5fav-Acme Corp")).toBe("9g5fav-acme-corp.md");
	});

	test("does not double .md extension", () => {
		expect(generateFilename("test.md")).toBe("test.md");
	});

	test("handles subdirectory slugs", () => {
		expect(generateFilename("2024/9g5fav-Acme Corp")).toBe("2024/9g5fav-acme-corp.md");
	});

	test("slugifies each segment independently", () => {
		expect(generateFilename("My Year/My Post")).toBe("my-year/my-post.md");
	});
});
