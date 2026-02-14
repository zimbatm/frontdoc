import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manager } from "../src/manager.js";

describe("Manager", () => {
	test("Init creates repository marker", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-init-"));
		const manager = await Manager.Init(root);

		expect(manager.RootPath()).toBe(root);
		expect(manager.Aliases()).toEqual({});
	});

	test("Init errors when already initialized", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-init-existing-"));
		await Manager.Init(root);
		await expect(Manager.Init(root)).rejects.toThrow("already initialized");
	});

	test("New loads schemas and aliases", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-new-"));
		await writeFile(join(root, "tmdoc.yaml"), "aliases:\n  cli: clients\n", "utf8");
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
	});
});
