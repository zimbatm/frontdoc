import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectionSchema } from "../../src/config/types.js";
import { Repository } from "../../src/repository/repository.js";
import { DocumentService } from "../../src/services/document-service.js";
import { ValidationService } from "../../src/services/validation-service.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

function makeServices(vfs: MemoryVFS): {
	documents: DocumentService;
	validation: ValidationService;
} {
	const schemas = new Map<string, CollectionSchema>([
		[
			"clients",
			{
				slug: "{{name}}-{{short_id}}",
				fields: {
					name: { type: "string", required: true },
					currency: { type: "currency" },
				},
				references: {},
			},
		],
		[
			"templates",
			{
				slug: "{{name}}-{{short_id}}",
				fields: {
					name: { type: "string", required: true },
					for: { type: "string", required: true },
				},
				references: {},
			},
		],
	]);
	const aliases = { cli: "clients", tpl: "templates" };
	const repo = new Repository(vfs);
	const documents = new DocumentService(schemas, aliases, repo);
	const validation = new ValidationService(
		schemas,
		aliases,
		[".DS_Store", "Thumbs.db"],
		repo,
	);
	return { documents, validation };
}

describe("ValidationService", () => {
	test("check detects and fixes filename mismatch", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		const { documents, validation } = makeServices(vfs);
		const created = await documents.Create({
			collection: "clients",
			fields: { name: "Acme" },
		});
		await vfs.rename(created.path, "clients/bad-name.md");

		const before = await validation.Check({});
		expect(before.issues.some((i) => i.code === "filename.mismatch")).toBe(true);

		const fixed = await validation.Check({ fix: true });
		expect(fixed.fixed).toBeGreaterThanOrEqual(1);

		const after = await validation.Check({});
		expect(after.issues.some((i) => i.code === "filename.mismatch")).toBe(false);
	});

	test("check can prune unreferenced attachments and collapse folder docs", async () => {
		const hostDir = await mkdtemp(join(tmpdir(), "tmdoc-attach-"));
		const source = join(hostDir, "asset.txt");
		await writeFile(source, "asset", "utf8");

		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		const { documents, validation } = makeServices(vfs);
		const created = await documents.Create({
			collection: "clients",
			fields: { name: "Acme" },
			content: "# Acme",
		});
		await documents.AttachFileByID(String(created.document.metadata._id), source, false, false);

		const folderPath = created.path.slice(0, -3);
		expect(await vfs.isDir(folderPath)).toBe(true);
		expect(await vfs.isFile(`${folderPath}/asset.txt`)).toBe(true);

		const res = await validation.Check({ fix: true, pruneAttachments: true });
		expect(res.fixed).toBeGreaterThanOrEqual(1);

		expect(await vfs.isDir(folderPath)).toBe(false);
		expect(await vfs.isFile(created.path)).toBe(true);
	});

	test("check validates wiki links and fixes stale link titles", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		const { documents, validation } = makeServices(vfs);
		const target = await documents.Create({
			collection: "clients",
			fields: { id: "01arz3ndektsv4rrffq69g5fav", name: "Target Document" },
		});
		const source = await documents.Create({
			collection: "clients",
			fields: { id: "01arz3ndektsv4rrffq69g5faw", name: "Source Document" },
			content: `[[${target.document.metadata._id}:Stale Title]]\n[[missing123:Broken]]`,
		});

		const before = await validation.Check({});
		expect(before.issues.some((i) => i.code === "wiki.stale-title")).toBe(true);
		expect(before.issues.some((i) => i.code === "wiki.broken")).toBe(true);

		const fixed = await validation.Check({ fix: true });
		expect(fixed.fixed).toBeGreaterThanOrEqual(1);

		const updatedRaw = await documents.ReadRawByID(String(source.document.metadata._id));
		expect(updatedRaw).toContain(`[[${target.document.metadata._id}:Target Document]]`);
		expect(updatedRaw).toContain("[[missing123:Broken]]");
	});

	test("check validates template 'for' collection values", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("templates");
		const { documents, validation } = makeServices(vfs);

		await documents.Create({
			collection: "templates",
			fields: {
				id: "01arz3ndektsv4rrffq69g5fb0",
				name: "Valid Template",
				for: "cli",
			},
			content: "# Valid",
		});
		await documents.Create({
			collection: "templates",
			fields: {
				id: "01arz3ndektsv4rrffq69g5fb1",
				name: "Invalid Template",
				for: "unknown_collection",
			},
			content: "# Invalid",
		});

		const result = await validation.Check({});
		const invalidTargetIssues = result.issues.filter((i) => i.code === "template.for.invalid");
		expect(invalidTargetIssues).toHaveLength(1);
		expect(invalidTargetIssues[0].message).toContain("unknown_collection");
	});
});
