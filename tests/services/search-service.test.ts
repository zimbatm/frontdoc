import { describe, expect, test } from "bun:test";
import { Repository } from "../../src/repository/repository.js";
import { SearchService } from "../../src/services/search-service.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

function doc(id: string, name: string, body: string, extra = ""): string {
	return `---\n_id: ${id}\nname: ${name}\n${extra}---\n\n${body}\n`;
}

async function setup(): Promise<SearchService> {
	const vfs = new MemoryVFS();
	await vfs.mkdirAll("clients");
	await vfs.mkdirAll("templates");
	await vfs.writeFile("clients/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
	await vfs.writeFile("templates/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
	await vfs.writeFile(
		"clients/abc123-acme.md",
		doc("01arz3ndektsv4rrffq6abc123", "Acme Corp", "Kubernetes migration plan", "status: active\n"),
	);
	await vfs.writeFile(
		"clients/def456-beta.md",
		doc(
			"01arz3ndektsv4rrffq6def456",
			"Beta Corp",
			"Invoice and billing notes",
			"status: archived\n",
		),
	);
	await vfs.writeFile(
		"templates/tmp001-template.md",
		doc("01arz3ndektsv4rrffq6tmp001", "Client Template", "Template body"),
	);

	return new SearchService(new Repository(vfs));
}

describe("SearchService", () => {
	test("structured query matches metadata and excludes templates", async () => {
		const service = await setup();
		const results = await service.UnifiedSearch("status:active");
		expect(results).toHaveLength(1);
		expect(results[0].document.path).toBe("clients/abc123-acme.md");
	});

	test("full-text ranking prefers exact name matches", async () => {
		const service = await setup();
		const results = await service.UnifiedSearch("Acme Corp");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].document.path).toBe("clients/abc123-acme.md");
		expect(results[0].tier).toBe(1);
	});

	test("top result disambiguation returns ambiguous tier peers", async () => {
		const service = await setup();
		const top = await service.GetTopResult("corp");
		expect(top.topResult).toBeNull();
		expect(top.ambiguousResults.length).toBeGreaterThanOrEqual(2);
	});
});
