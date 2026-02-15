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
	const validation = new ValidationService(schemas, aliases, [".DS_Store", "Thumbs.db"], repo);
	return { documents, validation };
}

describe("ValidationService", () => {
	test("check detects and fixes filename mismatch", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
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
		const hostDir = await mkdtemp(join(tmpdir(), "frontdoc-attach-"));
		const source = join(hostDir, "asset.txt");
		await writeFile(source, "asset", "utf8");

		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
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
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
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
		await vfs.writeFile("templates/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		const { documents, validation } = makeServices(vfs);
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');

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

	test("check suppresses folder collapse when index_file is set", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("skills");
		await vfs.writeFile(
			"skills/_schema.yaml",
			'slug: "{{name}}"\nindex_file: SKILL.md\nfields:\n  name:\n    type: string\n    required: true\n',
		);
		const schemas = new Map<string, CollectionSchema>([
			[
				"skills",
				{
					slug: "{{name}}",
					index_file: "SKILL.md",
					fields: { name: { type: "string", required: true } },
					references: {},
				},
			],
		]);
		const aliases = { skl: "skills" };
		const repo = new Repository(vfs);
		const documents = new DocumentService(schemas, aliases, repo);
		const validation = new ValidationService(schemas, aliases, [".DS_Store"], repo);

		const created = await documents.Create({
			collection: "skills",
			fields: { name: "my-skill" },
			content: "# My Skill",
		});
		expect(created.document.isFolder).toBe(true);
		expect(await vfs.isDir("skills/my-skill")).toBe(true);

		// Even though it has only the entry file, fix should NOT collapse it
		const result = await validation.Check({ fix: true, pruneAttachments: true });
		expect(await vfs.isDir("skills/my-skill")).toBe(true);
		expect(await vfs.isFile("skills/my-skill/SKILL.md")).toBe(true);
	});

	test("check ignores root-level markdown outside collections", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile("CLAUDE.md", "---\n_id: 01arz3ndektsv4rrffq69g5fb2\n---\n");
		const { validation } = makeServices(vfs);

		const result = await validation.Check({});
		expect(result.issues.some((i) => i.path === "CLAUDE.md")).toBe(false);
	});

	test("check validates array<reference> fields item-by-item", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile(
			"clients/_schema.yaml",
			'slug: "{{name}}-{{short_id}}"\nfields:\n  name:\n    type: string\n',
		);
		await vfs.mkdirAll("projects");
		await vfs.writeFile(
			"projects/_schema.yaml",
			'slug: "{{name}}-{{short_id}}"\nfields:\n  name:\n    type: string\n  client_ids:\n    type: array<reference>\nreferences:\n  client_ids: clients\n',
		);
		const schemas = new Map<string, CollectionSchema>([
			[
				"clients",
				{
					slug: "{{name}}-{{short_id}}",
					fields: { name: { type: "string", required: true } },
					references: {},
				},
			],
			[
				"projects",
				{
					slug: "{{name}}-{{short_id}}",
					fields: {
						name: { type: "string", required: true },
						client_ids: { type: "array<reference>" },
					},
					references: { client_ids: "clients" },
				},
			],
		]);
		const aliases = { cli: "clients", prj: "projects" };
		const repo = new Repository(vfs);
		const documents = new DocumentService(schemas, aliases, repo);
		const validation = new ValidationService(schemas, aliases, [".DS_Store"], repo);

		const c1 = await documents.Create({
			collection: "clients",
			fields: { id: "01arz3ndektsv4rrffq69g5fc1", name: "Acme" },
		});
		const c2 = await documents.Create({
			collection: "clients",
			fields: { id: "01arz3ndektsv4rrffq69g5fc2", name: "Beta" },
		});
		await documents.Create({
			collection: "projects",
			fields: {
				id: "01arz3ndektsv4rrffq69g5fc3",
				name: "Project One",
				client_ids: [c1.document.metadata._id, c2.document.metadata._id],
			},
		});
		await documents.Create({
			collection: "projects",
			fields: {
				id: "01arz3ndektsv4rrffq69g5fc4",
				name: "Broken Project",
				client_ids: [String(c1.document.metadata._id), "missing-id"],
			},
		});

		const result = await validation.Check({});
		const missing = result.issues.filter((i) => i.code === "reference.missing");
		expect(missing.some((i) => i.message.includes("missing-id"))).toBe(true);
	});

	test("check reports invalid url field values", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile(
			"clients/_schema.yaml",
			'slug: "{{name}}-{{short_id}}"\nfields:\n  name:\n    type: string\n  homepage:\n    type: url\n',
		);
		const schemas = new Map<string, CollectionSchema>([
			[
				"clients",
				{
					slug: "{{name}}-{{short_id}}",
					fields: {
						name: { type: "string", required: true },
						homepage: { type: "url" },
					},
					references: {},
				},
			],
		]);
		const aliases = { cli: "clients" };
		const repo = new Repository(vfs);
		const documents = new DocumentService(schemas, aliases, repo);
		const validation = new ValidationService(schemas, aliases, [".DS_Store"], repo);

		await documents.Create({
			collection: "clients",
			fields: {
				id: "01arz3ndektsv4rrffq69g5fc5",
				name: "Bad URL",
				homepage: "not-a-url",
			},
			skipValidation: true,
		});

		const result = await validation.Check({});
		expect(result.issues.some((i) => i.code === "field.url")).toBe(true);
	});
});
