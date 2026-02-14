import { describe, expect, test } from "bun:test";
import type { CollectionSchema } from "../../src/config/types.js";
import { Repository } from "../../src/repository/repository.js";
import { TemplateService } from "../../src/services/template-service.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

async function setup(): Promise<{
	service: TemplateService;
	schemas: Map<string, CollectionSchema>;
	aliases: Record<string, string>;
}> {
	const vfs = new MemoryVFS();
	await vfs.mkdirAll("templates");
	await vfs.writeFile("templates/_schema.yaml", 'slug: "{{name}}-{{short_id}}"\n');
	await vfs.writeFile(
		"templates/tmp001-client.md",
		"---\n_id: 01arz3ndektsv4rrffq6tmp001\nname: Client Onboarding\nfor: clients\n---\n\n# Client: {{name}}\n",
	);
	await vfs.writeFile(
		"templates/tmp002-project.md",
		"---\n_id: 01arz3ndektsv4rrffq6tmp002\nname: Project Kickoff\nfor: prj\n---\n\n# Project: {{name}}\n",
	);
	const schemas = new Map<string, CollectionSchema>([
		["templates", { slug: "{{name}}-{{short_id}}", fields: {}, references: {} }],
		["clients", { slug: "{{name}}-{{short_id}}", fields: {}, references: {} }],
		["projects", { slug: "{{name}}-{{short_id}}", fields: {}, references: {} }],
	]);
	const aliases = { cli: "clients", prj: "projects" };
	const service = new TemplateService(schemas, aliases, new Repository(vfs));
	return { service, schemas, aliases };
}

describe("TemplateService", () => {
	test("finds templates and filters by collection with alias resolution", async () => {
		const { service } = await setup();
		const clientTemplates = await service.GetTemplatesForCollection("cli");
		expect(clientTemplates).toHaveLength(1);
		expect(clientTemplates[0].name).toBe("Client Onboarding");

		const projectTemplates = await service.GetTemplatesForCollection("projects");
		expect(projectTemplates).toHaveLength(1);
		expect(projectTemplates[0].name).toBe("Project Kickoff");
	});

	test("processes template placeholders", async () => {
		const { service } = await setup();
		const out = service.ProcessTemplate("Hello {{name | upper}}", { name: "acme" });
		expect(out).toBe("Hello ACME");
	});

	test("returns empty when templates collection is not initialized", async () => {
		const vfs = new MemoryVFS();
		const schemas = new Map<string, CollectionSchema>([
			["clients", { slug: "{{name}}-{{short_id}}", fields: {}, references: {} }],
		]);
		const service = new TemplateService(
			schemas,
			{ cli: "clients" },
			new Repository(vfs),
		);
		const templates = await service.GetTemplatesForCollection("clients");
		expect(templates).toHaveLength(0);
	});

	test("sees collections added after service construction", async () => {
		const { service, schemas, aliases } = await setup();
		schemas.set("tickets", { slug: "{{name}}-{{short_id}}", fields: {}, references: {} });
		aliases.tix = "tickets";
		await expect(service.GetTemplatesForCollection("tix")).resolves.toEqual([]);
	});
});
