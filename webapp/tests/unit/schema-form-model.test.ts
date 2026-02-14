import { describe, expect, test } from "vitest";
import {
	buildUiSchemaFields,
	formStringValue,
	payloadValue,
} from "../../src/features/editor/schema-form-model";

describe("schema form model", () => {
	test("builds schema fields and includes unknown metadata keys", () => {
		const fields = buildUiSchemaFields(
			{
				fields: {
					name: { type: "string", required: true, weight: 10 },
					status: { type: "enum", enum_values: ["Active", "Pending"] },
				},
			},
			{
				name: "Acme",
				status: "Active",
				note: "Legacy",
				_created_at: "2026-01-01",
			},
		);

		expect(fields.map((f) => f.name)).toEqual(["name", "status", "note"]);
		expect(fields[0]?.required).toBe(true);
		expect(fields[1]?.enumValues).toEqual(["Active", "Pending"]);
		expect(fields[2]?.knownField).toBe(false);
	});

	test("formats and parses array field values", () => {
		expect(formStringValue("array", ["alpha", "beta"])).toBe("alpha\nbeta");
		expect(payloadValue("array", "alpha\nbeta, gamma")).toEqual(["alpha", "beta", "gamma"]);
	});
});
