import { describe, expect, test } from "bun:test";
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

	test("auto-appends short id when slug template omits short_id", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
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
		expect(created.path).toMatch(/^clients\/acme-corp-[a-z0-9]+\.md$/);
	});
});
