import { describe, expect, test } from "bun:test";
import {
	collectionFromPath,
	createDocumentUseCase,
	normalizeFieldsForSchema,
	updateDocumentUseCase,
} from "../../src/app/document-use-cases.js";
import type { CollectionSchema } from "../../src/config/types.js";
import type { DocumentRecord } from "../../src/repository/repository.js";

function record(path: string): DocumentRecord {
	return {
		path,
		document: {
			path,
			metadata: { _id: "01arz3ndektsv4rrffq6tmp001" },
			content: "",
			isFolder: false,
		},
		info: {
			name: path.split("/").at(-1) ?? "",
			path,
			isDirectory: false,
			isFile: true,
			isSymlink: false,
			size: 0,
			modifiedAt: new Date(),
		},
	};
}

describe("document use cases", () => {
	test("create delegates to document service", async () => {
		let called = false;
		const manager = {
			Documents: () => ({
				Create: async () => {
					called = true;
					return record("clients/acme.md");
				},
				UpdateByID: async () => record("clients/acme.md"),
			}),
		};

		await createDocumentUseCase(manager, { collection: "clients" });
		expect(called).toBe(true);
	});

	test("update forwards arguments to document service", async () => {
		let received: {
			id: string;
			options: {
				fields?: Record<string, unknown>;
				unsetFields?: string[];
				content?: string;
				skipValidation?: boolean;
			};
		} | null = null;
		const manager = {
			Documents: () => ({
				Create: async () => record("clients/acme.md"),
				UpdateByID: async (
					id: string,
					options: {
						fields?: Record<string, unknown>;
						unsetFields?: string[];
						content?: string;
						skipValidation?: boolean;
					},
				) => {
					received = { id, options };
					return record("clients/acme.md");
				},
			}),
		};

		await updateDocumentUseCase(manager, {
			id: "id",
			fields: { name: "Acme" },
			unsetFields: ["status"],
			content: "Hello",
			skipValidation: true,
		});
		expect(received).toEqual({
			id: "id",
			options: {
				fields: { name: "Acme" },
				unsetFields: ["status"],
				content: "Hello",
				skipValidation: true,
			},
		});
	});

	test("extracts collection from path", () => {
		expect(collectionFromPath("clients/acme.md")).toBe("clients");
		expect(collectionFromPath("acme.md")).toBe("acme.md");
	});

	test("normalizes boolean fields from string-like input", () => {
		const schema: CollectionSchema = {
			slug: "{{short_id}}",
			fields: {
				enabled: { type: "boolean" },
			},
			references: {},
		};
		const normalized = normalizeFieldsForSchema({ enabled: "yes" }, schema);
		expect(normalized.enabled).toBe(true);
	});

	test("rejects invalid boolean input", () => {
		const schema: CollectionSchema = {
			slug: "{{short_id}}",
			fields: {
				enabled: { type: "boolean" },
			},
			references: {},
		};
		expect(() => normalizeFieldsForSchema({ enabled: "sometimes" }, schema)).toThrow(
			"invalid boolean input",
		);
	});
});
