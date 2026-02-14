import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepositoryRoot } from "../../src/config/root-discovery.js";

describe("findRepositoryRoot", () => {
	test("finds root from nested directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-root-"));
		await writeFile(join(root, "tmdoc.yaml"), "aliases: {}\n", "utf8");
		const nested = join(root, "a", "b", "c");
		await mkdir(nested, { recursive: true });

		const found = await findRepositoryRoot(nested);
		expect(found).toBe(root);
	});

	test("throws when repository is not initialized", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-missing-"));
		await expect(findRepositoryRoot(root)).rejects.toThrow("repository is not initialized");
	});
});
