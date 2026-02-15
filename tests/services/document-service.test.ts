import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectionSchema } from "../../src/config/types.js";
import { Repository } from "../../src/repository/repository.js";
import { DocumentService } from "../../src/services/document-service.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

function makeService(vfs: MemoryVFS): DocumentService {
	const schemas = new Map<string, CollectionSchema>([
		[
			"clients",
			{
				slug: "{{name}}-{{short_id}}",
				fields: {
					name: { type: "string", required: true },
					status: { type: "string", default: "active" },
					due_date: { type: "date", default: "today" },
					starts_at: { type: "datetime", default: "+1" },
				},
				references: {},
			},
		],
	]);
	const repo = new Repository(vfs);
	return new DocumentService(schemas, { cli: "clients" }, repo);
}

describe("DocumentService", () => {
	test("create injects id/created_at/defaults and writes document", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		const service = makeService(vfs);

		const created = await service.Create({
			collection: "clients",
			fields: { name: "Acme Corp" },
			content: "# Acme",
		});

		expect(created.path.startsWith("clients/")).toBe(true);
		expect(typeof created.document.metadata._id).toBe("string");
		expect(typeof created.document.metadata._created_at).toBe("string");
		expect(created.document.metadata.status).toBe("active");
		expect(created.document.metadata.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(created.document.metadata.due_date).not.toBe("today");
		expect(created.document.metadata.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);

		const raw = await vfs.readFile(created.path);
		expect(raw).toContain("name: Acme Corp");
		expect(raw).toContain("status: active");
	});

	test("update applies fields/unset/content and auto-renames", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		const service = makeService(vfs);
		const created = await service.Create({
			collection: "clients",
			fields: { name: "Acme Corp" },
		});
		const id = String(created.document.metadata._id);

		const updated = await service.UpdateByID(id, {
			fields: { name: "Beta Corp", notes: "hello" },
			unsetFields: ["notes"],
			content: "# Updated",
		});

		expect(updated.path).not.toBe(created.path);
		expect(updated.path).toContain("beta-corp-");
		expect(updated.path).toContain(".md");
		expect(updated.document.content.trimStart()).toBe("# Updated");
		expect(updated.document.metadata.notes).toBeUndefined();
	});

	test("delete removes document by id", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		const service = makeService(vfs);
		const created = await service.Create({
			collection: "clients",
			fields: { name: "Acme Corp" },
		});
		const id = String(created.document.metadata._id);

		await service.DeleteByID(id);
		await expect(vfs.exists(created.path)).resolves.toBe(false);
	});

	test("upsert by slug returns existing then creates new", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		const service = makeService(vfs);

		const first = await service.UpsertBySlug("clients", ["Acme Corp"]);
		expect(first.created).toBe(true);

		const second = await service.UpsertBySlug("cli", ["Acme Corp"]);
		expect(second.created).toBe(false);
		expect(second.record.path).toBe(first.record.path);

		const third = await service.UpsertBySlug("clients", ["Beta Corp"]);
		expect(third.created).toBe(true);
		expect(third.record.path).not.toBe(first.record.path);
	});

	test("slug template without short_id produces filename without short_id", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}"\n');
		const schemas = new Map<string, CollectionSchema>([
			[
				"clients",
				{
					slug: "{{name}}",
					fields: { name: { type: "string", required: true } },
					references: {},
				},
			],
		]);
		const service = new DocumentService(schemas, { cli: "clients" }, new Repository(vfs));
		const created = await service.Create({
			collection: "clients",
			fields: { name: "Acme Corp" },
		});
		expect(created.path).toBe("clients/acme-corp.md");
	});

	test("create with index_file produces folder document", async () => {
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
		const service = new DocumentService(schemas, { skl: "skills" }, new Repository(vfs));
		const created = await service.Create({
			collection: "skills",
			fields: { name: "my-skill" },
			content: "# My Skill",
		});
		expect(created.path).toBe("skills/my-skill");
		expect(created.document.isFolder).toBe(true);
		expect(await vfs.isFile("skills/my-skill/SKILL.md")).toBe(true);
		const raw = await vfs.readFile("skills/my-skill/SKILL.md");
		expect(raw).toContain("name: my-skill");
		expect(raw).toContain("# My Skill");
	});

	test("attach writes binary bytes without utf8 conversion", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		const service = makeService(vfs);
		const created = await service.Create({
			collection: "clients",
			fields: { name: "Acme Corp" },
		});

		const tempDir = await mkdtemp(join(tmpdir(), "frontdoc-attach-"));
		const source = join(tempDir, "banner.bin");
		const payload = new Uint8Array([0, 255, 16, 128, 65, 66, 67]);
		await writeFile(source, payload);

		const attachedPath = await service.AttachFileByID(
			String(created.document.metadata._id),
			source,
			false,
		);
		const saved = await vfs.readFileBytes(attachedPath);
		expect(saved).toEqual(payload);
	});
});
