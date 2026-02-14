import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLock } from "../../src/storage/lock.js";

describe("FileLock", () => {
	test("acquire/release creates and removes lock file", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-lock-"));
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "tmdoc.yaml"), "aliases: {}\n", "utf8");

		const lock = new FileLock(root);
		await lock.acquire();
		expect(await Bun.file(join(root, ".tmdoc.lock")).exists()).toBe(true);
		await lock.release();
		expect(await Bun.file(join(root, ".tmdoc.lock")).exists()).toBe(false);
	});

	test("second lock waits until first is released", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-lock-wait-"));
		await writeFile(join(root, "tmdoc.yaml"), "aliases: {}\n", "utf8");

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
