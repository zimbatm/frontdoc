import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLock } from "../../src/storage/lock.js";

describe("FileLock", () => {
	test("acquire/release locks and unlocks frontdoc.yaml", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-lock-"));
		await mkdir(root, { recursive: true });
		const marker = join(root, "frontdoc.yaml");
		await writeFile(marker, "aliases: {}\n", "utf8");

		const lock = new FileLock(root);
		await lock.acquire();

		const whileHeld = spawnSync("flock", ["-n", marker, "true"]);
		expect(whileHeld.status).not.toBe(0);

		await lock.release();
		const afterRelease = spawnSync("flock", ["-n", marker, "true"]);
		expect(afterRelease.status).toBe(0);
	});

	test("second lock waits until first is released", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-lock-wait-"));
		await writeFile(join(root, "frontdoc.yaml"), "aliases: {}\n", "utf8");

		const lock1 = new FileLock(root);
		const lock2 = new FileLock(root);

		await lock1.acquire();
		let acquiredSecond = false;
		const waiter = (async () => {
			await lock2.acquire();
			acquiredSecond = true;
			await lock2.release();
		})();

		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(acquiredSecond).toBe(false);
		await lock1.release();
		await waiter;
		expect(acquiredSecond).toBe(true);
	});
});
