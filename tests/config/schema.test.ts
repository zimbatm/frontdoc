import { describe, expect, test } from "bun:test";
import { parseCollectionSchema } from "../../src/config/schema.js";

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
});
