import { describe, expect, test } from "bun:test";
import { Repository } from "../../src/repository/repository.js";
import { DraftService } from "../../src/services/draft-service.js";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

describe("DraftService", () => {
	test("writes with parent directory creation and reads content", async () => {
		const vfs = new MemoryVFS();
		const service = new DraftService(new Repository(vfs));
		await service.Write("clients/.tdo-abc.md", "hello");
		await expect(service.Read("clients/.tdo-abc.md")).resolves.toBe("hello");
	});

	test("removes files only when they exist", async () => {
		const vfs = new MemoryVFS();
		const service = new DraftService(new Repository(vfs));
		await service.Write("clients/.tdo-abc.md", "hello");
		await service.RemoveIfExists("clients/.tdo-abc.md");
		await service.RemoveIfExists("clients/.tdo-missing.md");
		await expect(vfs.exists("clients/.tdo-abc.md")).resolves.toBe(false);
	});
});
