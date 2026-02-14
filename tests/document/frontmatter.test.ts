import { describe, expect, test } from "bun:test";
import { parseFrontmatter, serializeFrontmatter } from "../../src/document/frontmatter.js";

describe("parseFrontmatter", () => {
	test("parses basic frontmatter", () => {
		const raw = `---
_id: "01arz3ndektsv4rrffq69g5fav"
_created_at: "2024-03-15T10:30:00Z"
name: Acme Corporation
---

# Acme Corporation`;

		const { metadata, content } = parseFrontmatter(raw);
		expect(metadata._id).toBe("01arz3ndektsv4rrffq69g5fav");
		expect(metadata._created_at).toBe("2024-03-15T10:30:00Z");
		expect(metadata.name).toBe("Acme Corporation");
		expect(content).toBe("\n# Acme Corporation");
	});

	test("returns empty metadata when no frontmatter", () => {
		const raw = "# Just content\n\nNo frontmatter here.";
		const { metadata, content } = parseFrontmatter(raw);
		expect(Object.keys(metadata)).toHaveLength(0);
		expect(content).toBe(raw);
	});

	test("throws on unclosed frontmatter", () => {
		const raw = "---\n_id: foo\nno closing delimiter";
		expect(() => parseFrontmatter(raw)).toThrow("unclosed frontmatter");
	});

	test("handles empty frontmatter", () => {
		const raw = "---\n---\ncontent after";
		const { metadata, content } = parseFrontmatter(raw);
		expect(Object.keys(metadata)).toHaveLength(0);
		expect(content).toBe("content after");
	});

	test("handles datetime values as strings", () => {
		const raw = `---
_created_at: "2024-03-15T10:30:00Z"
---
`;
		const { metadata } = parseFrontmatter(raw);
		expect(typeof metadata._created_at).toBe("string");
	});

	test("handles numeric values", () => {
		const raw = `---
amount: 42.5
count: 10
---
`;
		const { metadata } = parseFrontmatter(raw);
		expect(metadata.amount).toBe(42.5);
		expect(metadata.count).toBe(10);
	});

	test("handles array values", () => {
		const raw = `---
tags:
  - api
  - rest
---
`;
		const { metadata } = parseFrontmatter(raw);
		expect(metadata.tags).toEqual(["api", "rest"]);
	});
});

describe("serializeFrontmatter", () => {
	test("serializes with correct field ordering", () => {
		const metadata = {
			name: "Acme",
			_created_at: "2024-03-15T10:30:00Z",
			_id: "01arz3ndektsv4rrffq69g5fav",
			status: "active",
		};
		const content = "\n# Acme Corporation\n";
		const result = serializeFrontmatter(metadata, content);

		const lines = result.split("\n");
		expect(lines[0]).toBe("---");
		expect(lines[1]).toContain("_id:");
		expect(lines[2]).toContain("_created_at:");
		// remaining fields alphabetically: name, status
		expect(lines[3]).toContain("name:");
		expect(lines[4]).toContain("status:");
	});

	test("returns content only when metadata is empty", () => {
		const result = serializeFrontmatter({}, "# Hello");
		expect(result).toBe("# Hello");
	});

	test("adds blank line between closing delimiter and content", () => {
		const result = serializeFrontmatter({ _id: "abc" }, "# Hello");
		expect(result).toContain("---\n\n# Hello");
	});

	test("does not double blank line when content starts with newline", () => {
		const result = serializeFrontmatter({ _id: "abc" }, "\n# Hello");
		expect(result).toContain("---\n\n# Hello");
	});

	test("quotes datetime values", () => {
		const result = serializeFrontmatter({ _created_at: "2024-03-15T10:30:00Z" }, "content");
		expect(result).toContain('"2024-03-15T10:30:00Z"');
	});

	test("roundtrips correctly", () => {
		const originalMeta = {
			_id: "01arz3ndektsv4rrffq69g5fav",
			_created_at: "2024-03-15T10:30:00Z",
			name: "Test Doc",
			status: "active",
		};
		const originalContent = "\n# Test\n\nSome content here.\n";

		const serialized = serializeFrontmatter(originalMeta, originalContent);
		const { metadata, content } = parseFrontmatter(serialized);

		expect(metadata._id).toBe(originalMeta._id);
		expect(metadata._created_at).toBe(originalMeta._created_at);
		expect(metadata.name).toBe(originalMeta.name);
		expect(metadata.status).toBe(originalMeta.status);
		expect(content).toBe(originalContent);
	});
});
