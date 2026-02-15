import { describe, expect, test } from "bun:test";
import type { CollectionSchema } from "../../src/config/types.js";
import {
	expectedPathForDocument,
	generateDocumentFilename,
} from "../../src/document/path-policy.js";

describe("generateDocumentFilename", () => {
	test("does not append short_id when template omits it", () => {
		const schema: CollectionSchema = {
			slug: "{{name}}",
			fields: { name: { type: "string" } },
			references: {},
		};
		const result = generateDocumentFilename(schema, {
			name: "acme-corp",
			short_id: "9g5fav",
			date: "2024-03-22",
			_title: "",
		});
		expect(result).toBe("acme-corp.md");
	});

	test("preserves short_id when template includes it", () => {
		const schema: CollectionSchema = {
			slug: "{{name}}-{{short_id}}",
			fields: { name: { type: "string" } },
			references: {},
		};
		const result = generateDocumentFilename(schema, {
			name: "acme-corp",
			short_id: "9g5fav",
			date: "2024-03-22",
			_title: "",
		});
		expect(result).toBe("acme-corp-9g5fav.md");
	});

	test("renders date template without short_id", () => {
		const schema: CollectionSchema = {
			slug: "{{date}}",
			fields: { date: { type: "date" } },
			references: {},
		};
		const result = generateDocumentFilename(schema, {
			date: "2024-03-22",
			short_id: "abc123",
			_title: "",
		});
		expect(result).toBe("2024-03-22.md");
	});

	test("renders short_id-only template", () => {
		const schema: CollectionSchema = {
			slug: "{{short_id}}",
			fields: {},
			references: {},
		};
		const result = generateDocumentFilename(schema, {
			short_id: "9g5fav",
			date: "2024-03-22",
			_title: "",
		});
		expect(result).toBe("9g5fav.md");
	});
});

describe("expectedPathForDocument", () => {
	test("with index_file set, produces folder path", () => {
		const schema: CollectionSchema = {
			slug: "{{name}}",
			index_file: "SKILL.md",
			fields: { name: { type: "string" } },
			references: {},
		};
		const doc = {
			path: "skills/frontdoc-workflow",
			metadata: { _id: "01arz3ndektsv4rrffq69g5fav", name: "frontdoc-workflow" },
			content: "",
			isFolder: true,
		};
		const result = expectedPathForDocument(doc, schema, "skills");
		expect(result).toBe("skills/frontdoc-workflow");
	});

	test("without index_file, file doc gets .md path", () => {
		const schema: CollectionSchema = {
			slug: "{{name}}",
			fields: { name: { type: "string" } },
			references: {},
		};
		const doc = {
			path: "contacts/alice-chen.md",
			metadata: { _id: "01arz3ndektsv4rrffq69g5fav", name: "Alice Chen" },
			content: "",
			isFolder: false,
		};
		const result = expectedPathForDocument(doc, schema, "contacts");
		expect(result).toBe("contacts/alice-chen.md");
	});

	test("folder doc without index_file strips .md", () => {
		const schema: CollectionSchema = {
			slug: "{{name}}-{{short_id}}",
			fields: { name: { type: "string" } },
			references: {},
		};
		const doc = {
			path: "clients/acme-corp-9g5fav",
			metadata: { _id: "01arz3ndektsv4rrffq69g5fav", name: "Acme Corp" },
			content: "",
			isFolder: true,
		};
		const result = expectedPathForDocument(doc, schema, "clients");
		expect(result).toBe("clients/acme-corp-9g5fav");
	});
});
