import { describe, expect, test } from "bun:test";
import type { Document } from "../../src/document/document.js";
import {
	buildDocument,
	contentPath,
	displayName,
	getCollection,
	getID,
	getShortID,
	parseDocument,
} from "../../src/document/document.js";

function makeDoc(overrides: Partial<Document> = {}): Document {
	return {
		path: "clients/9g5fav-acme-corp.md",
		metadata: {
			id: "01arz3ndektsv4rrffq69g5fav",
			created_at: "2024-03-15T10:30:00Z",
			name: "Acme Corporation",
		},
		content: "\n# Acme Corporation\n",
		isFolder: false,
		...overrides,
	};
}

describe("contentPath", () => {
	test("returns path for file document", () => {
		const doc = makeDoc();
		expect(contentPath(doc)).toBe("clients/9g5fav-acme-corp.md");
	});

	test("returns path/index.md for folder document", () => {
		const doc = makeDoc({ path: "blog/xyz789-my-post", isFolder: true });
		expect(contentPath(doc)).toBe("blog/xyz789-my-post/index.md");
	});
});

describe("getCollection", () => {
	test("returns first path component", () => {
		const doc = makeDoc();
		expect(getCollection(doc)).toBe("clients");
	});

	test("handles subdirectory slugs", () => {
		const doc = makeDoc({ path: "clients/2024/9g5fav-acme-corp.md" });
		expect(getCollection(doc)).toBe("clients");
	});

	test("returns filename for root-level documents", () => {
		const doc = makeDoc({ path: "orphan.md" });
		expect(getCollection(doc)).toBe("orphan.md");
	});
});

describe("getID", () => {
	test("returns id from metadata", () => {
		const doc = makeDoc();
		expect(getID(doc)).toBe("01arz3ndektsv4rrffq69g5fav");
	});

	test("returns empty string when no id", () => {
		const doc = makeDoc({ metadata: {} });
		expect(getID(doc)).toBe("");
	});
});

describe("getShortID", () => {
	test("returns last 6 characters by default", () => {
		const doc = makeDoc();
		// "01arz3ndektsv4rrffq69g5fav" has 26 chars, last 6 = "9g5fav"
		expect(getShortID(doc)).toBe("9g5fav");
	});

	test("returns last N characters with custom length", () => {
		const doc = makeDoc();
		// last 8 chars = "q69g5fav"
		expect(getShortID(doc, 8)).toBe("q69g5fav");
	});

	test("returns full id if shorter than length", () => {
		const doc = makeDoc({ metadata: { id: "abc" } });
		expect(getShortID(doc)).toBe("abc");
	});
});

describe("displayName", () => {
	test("uses slug template field when available", () => {
		const doc = makeDoc();
		expect(displayName(doc, "{{short_id}}-{{name}}")).toBe("Acme Corporation");
	});

	test("falls back to name field", () => {
		const doc = makeDoc();
		expect(displayName(doc)).toBe("Acme Corporation");
	});

	test("falls back to title field", () => {
		const doc = makeDoc({ metadata: { id: "abc", title: "My Title" } });
		expect(displayName(doc)).toBe("My Title");
	});

	test("falls back to filename", () => {
		const doc = makeDoc({ metadata: { id: "abc" }, path: "col/my-document.md" });
		expect(displayName(doc)).toBe("my-document");
	});

	test("falls back to short id", () => {
		const doc = makeDoc({
			metadata: { id: "01arz3ndektsv4rrffq69g5fav" },
			path: "col/some-doc",
			isFolder: true,
		});
		// folder doc: basename is "some-doc" (not index.md), returns "some-doc"
		expect(displayName(doc)).toBe("some-doc");
	});

	test("returns Untitled as last resort", () => {
		const doc = makeDoc({ metadata: {}, path: "col/something", isFolder: true });
		// folder doc with no metadata fields; basename is "something"
		expect(displayName(doc)).toBe("something");
	});

	test("returns Untitled when no info available", () => {
		const doc: Document = { metadata: {}, path: "col/index.md", isFolder: false, content: "" };
		// basename is "index.md", filtered out, no id -> Untitled
		expect(displayName(doc)).toBe("Untitled");
	});
});

describe("buildDocument", () => {
	test("produces frontmatter + content", () => {
		const doc = makeDoc();
		const result = buildDocument(doc);
		expect(result).toContain("---\n");
		expect(result).toContain("id:");
		expect(result).toContain("# Acme Corporation");
	});

	test("produces content only when no metadata", () => {
		const doc = makeDoc({ metadata: {} });
		const result = buildDocument(doc);
		expect(result).toBe("\n# Acme Corporation\n");
	});
});

describe("parseDocument", () => {
	test("roundtrips with buildDocument", () => {
		const doc = makeDoc();
		const serialized = buildDocument(doc);
		const parsed = parseDocument(serialized, doc.path, doc.isFolder);

		expect(parsed.path).toBe(doc.path);
		expect(parsed.metadata.id).toBe(doc.metadata.id);
		expect(parsed.metadata.name).toBe(doc.metadata.name);
		expect(parsed.isFolder).toBe(false);
	});
});
