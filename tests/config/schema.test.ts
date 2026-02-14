import { describe, expect, test } from "bun:test";
import { parseCollectionSchema } from "../../src/config/schema.js";

describe("parseCollectionSchema", () => {
	test("accepts valid field defaults", () => {
		const schema = parseCollectionSchema(`slug: "{{short_id}}-{{name}}"
short_id_length: 8
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

	test("rejects out-of-range short_id_length", () => {
		expect(() =>
			parseCollectionSchema(`slug: "{{short_id}}"
short_id_length: 3
`),
		).toThrow("short_id_length");
	});
});
