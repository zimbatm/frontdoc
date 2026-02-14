import { describe, expect, test } from "bun:test";
import { collectionFromPath } from "../../src/document/path-utils.js";

describe("path utils", () => {
	test("extracts collection from repository paths", () => {
		expect(collectionFromPath("clients/acme.md")).toBe("clients");
		expect(collectionFromPath("clients/folder/index.md")).toBe("clients");
		expect(collectionFromPath("single.md")).toBe("single.md");
	});
});
