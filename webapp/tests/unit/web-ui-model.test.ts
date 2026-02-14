import { describe, expect, test } from "vitest";
import { buildDocRoute, parseRoutePath, routeKeyFromPath } from "../../src/web-ui-model";

describe("web ui model", () => {
	test("parses collection and document routes", () => {
		expect(parseRoutePath("/c/clients")).toEqual({ kind: "collection", collection: "clients" });
		expect(parseRoutePath("/c/clients/alice-123")).toEqual({
			kind: "doc",
			collection: "clients",
			docKey: "alice-123",
		});
	});

	test("builds canonical route from document path", () => {
		expect(routeKeyFromPath("clients", "clients/alice-123.md")).toBe("alice-123");
		expect(
			buildDocRoute({
				collection: "clients",
				path: "clients/alice-123.md",
			}),
		).toBe("/c/clients/alice-123");
	});
});
