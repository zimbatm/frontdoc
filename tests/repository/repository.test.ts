import { describe, expect, test } from "bun:test";
import { byCollection, byField, hasField, Repository } from "../../src/repository/repository.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

function doc(id: string, name: string): string {
	return `---\n_id: ${id}\nname: ${name}\n---\n\n# ${name}\n`;
}

describe("Repository", () => {
	test("collectAll collects file and folder documents", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile("clients/abc123-acme.md", doc("01arz3ndektsv4rrffq6abc123", "Acme"));
		await vfs.writeFile("README-not-a-doc.md", doc("01arz3ndektsv4rrffq6zzz001", "Root"));
		await vfs.mkdirAll("scratch");
		await vfs.writeFile("scratch/note.md", doc("01arz3ndektsv4rrffq6zzz002", "Scratch"));

		await vfs.mkdirAll("projects/proj001-roadmap");
		await vfs.writeFile("projects/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile(
			"projects/proj001-roadmap/index.md",
			doc("01arz3ndektsv4rrffq69proj1", "Roadmap"),
		);
		await vfs.writeFile("projects/proj001-roadmap/banner.png", "binary");

		const repo = new Repository(vfs);
		const records = await repo.collectAll();
		const paths = records.map((r) => r.path).sort();

		expect(paths).toEqual(["clients/abc123-acme.md", "projects/proj001-roadmap"]);
		expect(records.find((r) => r.path === "projects/proj001-roadmap")?.document.isFolder).toBe(
			true,
		);
	});

	test("collectAll applies filters", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile(
			"clients/abc123-acme.md",
			"---\n_id: 01arz3ndektsv4rrffq6abc123\nname: Acme\nstatus: active\n---\n",
		);
		await vfs.writeFile(
			"clients/def456-beta.md",
			"---\n_id: 01arz3ndektsv4rrffq69def45\nname: Beta\nstatus: archived\n---\n",
		);

		const repo = new Repository(vfs);
		const filtered = await repo.collectAll(
			byCollection("clients"),
			byField("status", "active"),
			hasField("name"),
		);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].path).toBe("clients/abc123-acme.md");
	});

	test("findByID supports plain and collection-scoped ids", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile("clients/abc123-acme.md", doc("01arz3ndektsv4rrffq6abc123", "Acme"));

		const repo = new Repository(vfs);
		const byPlain = await repo.findByID("abc123");
		expect(byPlain.path).toBe("clients/abc123-acme.md");

		const byScoped = await repo.findByID("clients/abc123");
		expect(byScoped.path).toBe("clients/abc123-acme.md");
	});

	test("findByID matches metadata id even when filename has no id prefix", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("journal");
		await vfs.writeFile("journal/_schema.yaml", 'slug: "journal-{{date}}-{{short_id}}"\n');
		await vfs.writeFile(
			"journal/journal-2026-02-14.md",
			doc("01khdw60we90w6fb5rajbbjer9", "Daily log"),
		);

		const repo = new Repository(vfs);
		const byFullID = await repo.findByID("01khdw60we90w6fb5rajbbjer9");
		expect(byFullID.path).toBe("journal/journal-2026-02-14.md");
	});

	test("findByID errors on ambiguity", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile("clients/abc123-acme.md", doc("01arz3ndektsv4rrffq69abc12", "Acme"));
		await vfs.writeFile("clients/abc456-beta.md", doc("01arz3ndektsv4rrffq69abc45", "Beta"));

		const repo = new Repository(vfs);
		await expect(repo.findByID("abc")).rejects.toThrow("multiple documents match");
	});

	test("cache is invalidated by repository file system writes", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile("clients/abc123-acme.md", doc("01arz3ndektsv4rrffq6abc123", "Acme"));

		const repo = new Repository(vfs);
		const first = await repo.collectAll();
		expect(first).toHaveLength(1);

		await repo
			.fileSystem()
			.writeFile("clients/def456-beta.md", doc("01arz3ndektsv4rrffq69def45", "Beta"));

		const second = await repo.collectAll();
		expect(second).toHaveLength(2);
	});

	test("cached records are returned as clones", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile("clients/abc123-acme.md", doc("01arz3ndektsv4rrffq6abc123", "Acme"));

		const repo = new Repository(vfs);
		const first = await repo.findByID("abc123");
		first.document.metadata.name = "Mutated";

		const second = await repo.findByID("abc123");
		expect(second.document.metadata.name).toBe("Acme");
	});

	test("repository ID can be provided and read", async () => {
		const repo = new Repository(new MemoryVFS(), "repo-123");
		expect(repo.repositoryID()).toBe("repo-123");
	});

	test("cache entries are isolated by repository ID", async () => {
		const vfsA = new MemoryVFS();
		await vfsA.mkdirAll("clients");
		await vfsA.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfsA.writeFile("clients/abc123-acme.md", doc("01arz3ndektsv4rrffq6abc123", "Acme"));

		const vfsB = new MemoryVFS();
		await vfsB.mkdirAll("clients");
		await vfsB.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfsB.writeFile("clients/def456-beta.md", doc("01arz3ndektsv4rrffq69def45", "Beta"));

		const repoA = new Repository(vfsA, "repo-A");
		const repoB = new Repository(vfsB, "repo-B");

		const recordsA = await repoA.collectAll();
		const recordsB = await repoB.collectAll();

		expect(recordsA).toHaveLength(1);
		expect(recordsA[0].document.metadata.name).toBe("Acme");
		expect(recordsB).toHaveLength(1);
		expect(recordsB[0].document.metadata.name).toBe("Beta");
	});

	test("cache entries are shared for same repository ID", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("clients");
		await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
		await vfs.writeFile("clients/abc123-acme.md", doc("01arz3ndektsv4rrffq6abc123", "Acme"));

		const repoA = new Repository(vfs, "repo-shared");
		const repoB = new Repository(vfs, "repo-shared");

		const first = await repoA.collectAll();
		expect(first).toHaveLength(1);

		await repoB
			.fileSystem()
			.writeFile("clients/def456-beta.md", doc("01arz3ndektsv4rrffq69def45", "Beta"));

		const second = await repoA.collectAll();
		expect(second).toHaveLength(2);
	});
});
