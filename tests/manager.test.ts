import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manager } from "../src/manager.js";

describe("Manager", () => {
	test("Init creates repository marker", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-init-"));
		const manager = await Manager.Init(root);

		expect(manager.RootPath()).toBe(root);
		expect(manager.Aliases()).toEqual({});
		const raw = await readFile(join(root, "frontdoc.yaml"), "utf8");
		expect(raw).toContain("repository_id:");
	});

	test("Init errors when already initialized", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-init-existing-"));
		await Manager.Init(root);
		await expect(Manager.Init(root)).rejects.toThrow("already initialized");
	});

	test("New loads schemas and aliases", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-new-"));
		await writeFile(join(root, "frontdoc.yaml"), "aliases:\n  cli: clients\n", "utf8");
		await mkdir(join(root, "clients"), { recursive: true });
		await writeFile(
			join(root, "clients", "_schema.yaml"),
			'slug: "{{name}}-{{short_id}}"\nfields:\n  name:\n    type: string\n',
			"utf8",
		);

		const manager = await Manager.New(root);
		expect(manager.Aliases()).toEqual({ cli: "clients" });
		expect(manager.Schemas().has("clients")).toBe(true);
		expect(manager.Schema().read("cli").collection).toBe("clients");
		const raw = await readFile(join(root, "frontdoc.yaml"), "utf8");
		expect(raw).toContain("repository_id:");
	});

	test("New preserves existing repository_id", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-new-id-"));
		const repositoryID = "01arz3ndektsv4rrffq69g5fav";
		await writeFile(
			join(root, "frontdoc.yaml"),
			`repository_id: ${repositoryID}\naliases:\n  cli: clients\n`,
			"utf8",
		);
		await mkdir(join(root, "clients"), { recursive: true });
		await writeFile(
			join(root, "clients", "_schema.yaml"),
			'slug: "{{name}}-{{short_id}}"\n',
			"utf8",
		);

		const manager = await Manager.New(root);
		expect(manager.Repository().repositoryID()).toBe(repositoryID);

		const raw = await readFile(join(root, "frontdoc.yaml"), "utf8");
		expect(raw).toContain(`repository_id: ${repositoryID}`);
	});
});
