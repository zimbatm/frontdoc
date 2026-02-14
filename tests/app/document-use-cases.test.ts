import { describe, expect, test } from "bun:test";
import type { DocumentRecord } from "../../src/repository/repository.js";
import {
	assertNoValidationErrorsForPath,
	collectionFromPath,
	createDocumentUseCase,
	updateDocumentUseCase,
} from "../../src/app/document-use-cases.js";

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
	test("create validates written path by default", async () => {
		let validated = false;
		const manager = {
			Documents: () => ({
				Create: async () => record("clients/acme.md"),
				UpdateByID: async () => record("clients/acme.md"),
			}),
			Validation: () => ({
				Check: async () => {
					validated = true;
					return { issues: [] };
				},
			}),
		};

		await createDocumentUseCase(manager, { collection: "clients" });
		expect(validated).toBe(true);
	});

	test("update skips validation when requested", async () => {
		let validated = false;
		const manager = {
			Documents: () => ({
				Create: async () => record("clients/acme.md"),
				UpdateByID: async () => record("clients/acme.md"),
			}),
			Validation: () => ({
				Check: async () => {
					validated = true;
					return { issues: [] };
				},
			}),
		};

		await updateDocumentUseCase(manager, { id: "id", skipValidation: true });
		expect(validated).toBe(false);
	});

	test("assert helper reports errors for target path only", async () => {
		const manager = {
			Documents: () => ({
				Create: async () => record("clients/acme.md"),
				UpdateByID: async () => record("clients/acme.md"),
			}),
			Validation: () => ({
				Check: async () => ({
					issues: [
						{
							severity: "error" as const,
							path: "clients/acme.md",
							code: "field.required",
							message: "missing required field",
						},
						{
							severity: "error" as const,
							path: "clients/other.md",
							code: "field.required",
							message: "other",
						},
					],
				}),
			}),
		};

		await expect(assertNoValidationErrorsForPath(manager, "clients/acme.md")).rejects.toThrow(
			"field.required: missing required field",
		);
	});

	test("extracts collection from path", () => {
		expect(collectionFromPath("clients/acme.md")).toBe("clients");
		expect(collectionFromPath("acme.md")).toBe("acme.md");
	});
});
