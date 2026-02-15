import { describe, expect, test } from "bun:test";
import {
	discoverCollections,
	generateDefaultSlug,
	parseCollectionSchema,
} from "../../src/config/schema.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

describe("parseCollectionSchema", () => {
	test("accepts valid field defaults", () => {
		const schema = parseCollectionSchema(`slug: "{{name}}-{{short_id}}"
short_id_length: 8
title_field: due_date
fields:
  name:
    type: string
    default: Acme
  due_date:
    type: date
    default: 2026-02-14
  starts_at:
    type: datetime
    default: "2026-02-14T00:00:00Z"
  next_review:
    type: date
    default: today
  reminder_at:
    type: datetime
    default: tomorrow
  budget:
    type: number
    default: "42.5"
  enabled:
    type: boolean
    default: true
  scores:
    type: array<number>
    default: [1, "2.5"]
  status:
    type: enum
    enum_values: [Open, Closed]
    default: open
`);
		expect(schema.short_id_length).toBe(8);
		expect(schema.title_field).toBe("due_date");
		expect(schema.fields.name.default).toBe("Acme");
	});

	test("rejects invalid field defaults", () => {
		expect(() =>
			parseCollectionSchema(`slug: "{{short_id}}"
fields:
  due_date:
    type: date
    default: next_week
`),
		).toThrow("invalid _schema.yaml");
	});

	test("accepts slug template without short_id placeholder", () => {
		const schema = parseCollectionSchema(`slug: "{{name}}"
fields:
  name:
    type: string
`);
		expect(schema.slug).toBe("{{name}}");
	});

	test("uses default slug when slug field is omitted", () => {
		const schema = parseCollectionSchema(`fields:
  name:
    type: string
    required: true
`);
		expect(schema.slug).toBe("{{name}}-{{short_id}}");
	});

	test("uses {{short_id}} default slug when no title/name/subject field", () => {
		const schema = parseCollectionSchema(`fields:
  email:
    type: email
`);
		expect(schema.slug).toBe("{{short_id}}");
	});

	test("rejects out-of-range short_id_length", () => {
		expect(() =>
			parseCollectionSchema(`slug: "{{short_id}}"
short_id_length: 3
`),
		).toThrow("short_id_length");
	});

	test("rejects empty title_field", () => {
		expect(() =>
			parseCollectionSchema(`slug: "{{short_id}}"
title_field: "  "
`),
		).toThrow("title_field");
	});

	test("parses index_file from schema", () => {
		const schema = parseCollectionSchema(`slug: "{{name}}"
index_file: SKILL.md
fields:
  name:
    type: string
`);
		expect(schema.index_file).toBe("SKILL.md");
	});

	test("round-trips index_file through serialization", async () => {
		const { serializeCollectionSchema } = await import("../../src/config/schema.js");
		const schema = parseCollectionSchema(`slug: "{{name}}"
index_file: SKILL.md
fields:
  name:
    type: string
`);
		const serialized = serializeCollectionSchema(schema);
		const reparsed = parseCollectionSchema(serialized);
		expect(reparsed.index_file).toBe("SKILL.md");
	});

	test("rejects empty index_file", () => {
		expect(() =>
			parseCollectionSchema(`slug: "{{short_id}}"
index_file: "  "
`),
		).toThrow("index_file must not be empty");
	});

	test("rejects index_file not ending with .md", () => {
		expect(() =>
			parseCollectionSchema(`slug: "{{short_id}}"
index_file: SKILL.txt
`),
		).toThrow("index_file must end with .md");
	});
});

describe("generateDefaultSlug", () => {
	test("produces {{name}}-{{short_id}} when name field exists", () => {
		const slug = generateDefaultSlug({ name: { type: "string" } });
		expect(slug).toBe("{{name}}-{{short_id}}");
	});

	test("produces {{title}}-{{short_id}} when title field exists", () => {
		const slug = generateDefaultSlug({ title: { type: "string" } });
		expect(slug).toBe("{{title}}-{{short_id}}");
	});

	test("produces {{short_id}} when no title/name/subject field", () => {
		const slug = generateDefaultSlug({ email: { type: "email" } });
		expect(slug).toBe("{{short_id}}");
	});

	test("checks title before name before subject", () => {
		const slug = generateDefaultSlug({
			subject: { type: "string" },
			name: { type: "string" },
			title: { type: "string" },
		});
		expect(slug).toBe("{{title}}-{{short_id}}");
	});
});

describe("discoverCollections", () => {
	test("skips dot-prefixed directories", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.mkdirAll(".claude");
		await vfs.writeFile(".claude/skills", "symlink target");

		const collections = await discoverCollections(vfs);
		expect(collections.has("clients")).toBe(true);
		expect(collections.has(".claude")).toBe(false);
	});
});
