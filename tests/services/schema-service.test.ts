import { describe, expect, test } from "bun:test";
import { parseRepoConfig } from "../../src/config/repo-config.js";
import { parseCollectionSchema, serializeCollectionSchema } from "../../src/config/schema.js";
import type { RepoConfig } from "../../src/config/types.js";
import { Repository } from "../../src/repository/repository.js";
import { SchemaService } from "../../src/services/schema-service.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

async function setup(): Promise<{
	vfs: MemoryVFS;
	service: SchemaService;
	schemas: Map<string, ReturnType<typeof parseCollectionSchema>>;
	repoConfig: RepoConfig;
}> {
	const vfs = new MemoryVFS();
	await vfs.writeFile("tmdoc.yaml", "aliases:\n  cli: clients\n");
	await vfs.mkdirAll("clients");
	await vfs.writeFile(
		"clients/_schema.yaml",
		serializeCollectionSchema({
			slug: "{{short_id}}-{{name}}",
			fields: { name: { type: "string", required: true } },
			references: {},
		}),
	);
	await vfs.writeFile(
		"clients/abc123-acme.md",
		"---\n_id: 01arz3ndektsv4rrffq6abc123\nname: Acme\n---\n\n# Acme\n",
	);

	const repoConfig = parseRepoConfig(await vfs.readFile("tmdoc.yaml"));
	const schemas = new Map();
	schemas.set("clients", parseCollectionSchema(await vfs.readFile("clients/_schema.yaml")));
	const service = new SchemaService(schemas, repoConfig, new Repository(vfs));
	return { vfs, service, schemas, repoConfig };
}

describe("SchemaService", () => {
	test("add/update/remove collection persists schema and aliases", async () => {
		const { vfs, service } = await setup();
		await service.AddCollection({ name: "projects", slug: "{{short_id}}-{{title}}" });
		expect(await vfs.exists("projects/_schema.yaml")).toBe(true);

		const updated = await service.UpdateCollection({
			name: "projects",
			slug: "{{short_id}}-{{name}}",
			alias: "prj",
		});
		expect(updated.alias).toBe("prj");

		await service.RemoveCollection({ name: "projects", force: true });
		expect(await vfs.exists("projects/_schema.yaml")).toBe(false);
	});

	test("rename collection updates references and aliases", async () => {
		const { vfs, service, schemas } = await setup();
		await service.AddCollection({
			name: "projects",
			slug: "{{short_id}}-{{name}}",
			fields: { name: { type: "string" }, client_id: { type: "reference" } },
			references: { client_id: "clients" },
			alias: "prj",
		});

		await service.RenameCollection("clients", "customers");
		expect(schemas.has("customers")).toBe(true);
		expect(schemas.has("clients")).toBe(false);
		expect(schemas.get("projects")?.references.client_id).toBe("customers");

		const repoConfigRaw = await vfs.readFile("tmdoc.yaml");
		expect(repoConfigRaw).toContain("customers");
	});

	test("field create/update/delete works", async () => {
		const { service } = await setup();
		await service.AddFieldToCollection("clients", "status", {
			type: "enum",
			enum_values: ["active", "archived"],
		});
		let read = service.read("clients");
		expect(read.schema.fields.status?.type).toBe("enum");

		await service.UpdateFieldInCollection("clients", "status", {
			required: true,
			default: "active",
		});
		read = service.read("clients");
		expect(read.schema.fields.status?.required).toBe(true);
		expect(read.schema.fields.status?.default).toBe("active");

		await service.RemoveFieldFromCollection("clients", "status");
		read = service.read("clients");
		expect(read.schema.fields.status).toBeUndefined();
	});

	test("remove non-empty collection requires remove-documents or force", async () => {
		const { service } = await setup();
		await expect(service.RemoveCollection({ name: "clients" })).rejects.toThrow("has 1 documents");
		await service.RemoveCollection({ name: "clients", removeDocuments: true });
	});
});
