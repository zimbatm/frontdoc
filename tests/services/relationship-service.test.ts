import { describe, expect, test } from "bun:test";
import type { CollectionSchema } from "../../src/config/types.js";
import { Repository } from "../../src/repository/repository.js";
import { RelationshipService } from "../../src/services/relationship-service.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

function doc(meta: string, body: string): string {
	return `---\n${meta}---\n\n${body}\n`;
}

async function setup(): Promise<RelationshipService> {
	const vfs = new MemoryVFS();
	await vfs.mkdirAll("clients");
	await vfs.mkdirAll("projects");
	await vfs.writeFile("clients/_schema.yaml", 'slug: "{{short_id}}-{{name}}"\n');
	await vfs.writeFile(
		"projects/_schema.yaml",
		'slug: "{{short_id}}-{{name}}"\nreferences:\n  client_id: clients\n',
	);

	await vfs.writeFile(
		"clients/abc123-acme.md",
		doc("id: 01arz3ndektsv4rrffq6abc123\nname: Acme\n", "# Acme"),
	);
	await vfs.writeFile(
		"projects/proj01-roadmap.md",
		doc(
			"id: 01arz3ndektsv4rrffq6proj01\nname: Roadmap\nclient_id: abc123\n",
			"See [[abc123:Acme]]",
		),
	);

	const schemas = new Map<string, CollectionSchema>([
		["clients", { slug: "{{short_id}}-{{name}}", fields: {}, references: {} }],
		[
			"projects",
			{ slug: "{{short_id}}-{{name}}", fields: {}, references: { client_id: "clients" } },
		],
	]);

	return new RelationshipService(schemas, new Repository(vfs));
}

describe("RelationshipService", () => {
	test("relationships include outgoing and incoming wiki/reference edges", async () => {
		const service = await setup();
		const rel = await service.GetRelationships("abc123");
		expect(rel.incoming.some((e) => e.type === "reference" && e.field === "client_id")).toBe(true);
		expect(rel.incoming.some((e) => e.type === "wiki")).toBe(true);
	});

	test("graph renderers produce dot and mermaid content", async () => {
		const service = await setup();
		const edges = await service.BuildGraph();
		const dot = service.ToDot(edges);
		const mermaid = service.ToMermaid(edges);
		expect(dot).toContain("digraph tmdoc");
		expect(mermaid).toContain("graph TD");
	});

	test("stats count by collection", async () => {
		const service = await setup();
		const stats = await service.Stats();
		expect(stats.total).toBe(2);
		expect(stats.byCollection.clients).toBe(1);
		expect(stats.byCollection.projects).toBe(1);
	});
});
