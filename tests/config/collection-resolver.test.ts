import { describe, expect, test } from "bun:test";
import { resolveCollection } from "../../src/config/collection-resolver.js";
import type { CollectionSchema } from "../../src/config/types.js";

function schemaMap(names: string[]): Map<string, CollectionSchema> {
	const map = new Map<string, CollectionSchema>();
	for (const name of names) {
		map.set(name, { slug: "{{short_id}}", fields: {}, references: {} });
	}
	return map;
}

describe("collection resolver", () => {
	test("resolves aliases from shared schema map", () => {
		const schemas = schemaMap(["clients"]);
		expect(resolveCollection("cli", { cli: "clients" }, schemas)).toBe("clients");
	});

	test("sees collections added after map mutation", () => {
		const schemas = schemaMap(["clients"]);
		schemas.set("tickets", { slug: "{{short_id}}", fields: {}, references: {} });
		expect(resolveCollection("tickets", {}, schemas)).toBe("tickets");
	});
});
