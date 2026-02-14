import { describe, expect, test } from "bun:test";
import { MemoryVFS } from "../../src/storage/memory-vfs.js";

describe("MemoryVFS", () => {
	test("root returns /", () => {
		const vfs = new MemoryVFS();
		expect(vfs.root()).toBe("/");
	});

	test("writeFile and readFile", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("docs");
		await vfs.writeFile("docs/hello.md", "# Hello");
		const content = await vfs.readFile("docs/hello.md");
		expect(content).toBe("# Hello");
	});

	test("readFile throws on missing file", async () => {
		const vfs = new MemoryVFS();
		await expect(vfs.readFile("missing.txt")).rejects.toThrow("file not found");
	});

	test("writeFile throws if parent dir missing", async () => {
		const vfs = new MemoryVFS();
		await expect(vfs.writeFile("a/b/c.txt", "data")).rejects.toThrow(
			"parent directory does not exist",
		);
	});

	test("exists", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("foo");
		await vfs.writeFile("foo/bar.txt", "data");
		expect(await vfs.exists("foo")).toBe(true);
		expect(await vfs.exists("foo/bar.txt")).toBe(true);
		expect(await vfs.exists("missing")).toBe(false);
	});

	test("isDir and isFile", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("dir");
		await vfs.writeFile("dir/file.txt", "data");
		expect(await vfs.isDir("dir")).toBe(true);
		expect(await vfs.isFile("dir")).toBe(false);
		expect(await vfs.isFile("dir/file.txt")).toBe(true);
		expect(await vfs.isDir("dir/file.txt")).toBe(false);
	});

	test("mkdirAll creates nested directories", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("a/b/c");
		expect(await vfs.isDir("a")).toBe(true);
		expect(await vfs.isDir("a/b")).toBe(true);
		expect(await vfs.isDir("a/b/c")).toBe(true);
	});

	test("remove file", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("dir");
		await vfs.writeFile("dir/file.txt", "data");
		await vfs.remove("dir/file.txt");
		expect(await vfs.exists("dir/file.txt")).toBe(false);
	});

	test("remove non-empty dir throws", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("dir");
		await vfs.writeFile("dir/file.txt", "data");
		await expect(vfs.remove("dir")).rejects.toThrow("directory not empty");
	});

	test("removeAll removes recursively", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("dir/sub");
		await vfs.writeFile("dir/a.txt", "a");
		await vfs.writeFile("dir/sub/b.txt", "b");
		await vfs.removeAll("dir");
		expect(await vfs.exists("dir")).toBe(false);
		expect(await vfs.exists("dir/a.txt")).toBe(false);
		expect(await vfs.exists("dir/sub/b.txt")).toBe(false);
	});

	test("rename file", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("dir");
		await vfs.writeFile("dir/old.txt", "content");
		await vfs.rename("dir/old.txt", "dir/new.txt");
		expect(await vfs.exists("dir/old.txt")).toBe(false);
		const content = await vfs.readFile("dir/new.txt");
		expect(content).toBe("content");
	});

	test("rename directory", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("old/sub");
		await vfs.writeFile("old/file.txt", "data");
		await vfs.writeFile("old/sub/nested.txt", "nested");
		await vfs.rename("old", "new");
		expect(await vfs.exists("old")).toBe(false);
		expect(await vfs.exists("new")).toBe(true);
		expect(await vfs.readFile("new/file.txt")).toBe("data");
		expect(await vfs.readFile("new/sub/nested.txt")).toBe("nested");
	});

	test("readDir lists direct children", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("dir/sub");
		await vfs.writeFile("dir/a.txt", "a");
		await vfs.writeFile("dir/b.txt", "b");
		await vfs.writeFile("dir/sub/c.txt", "c");

		const entries = await vfs.readDir("dir");
		const names = entries.map((e) => e.name);
		expect(names).toEqual(["a.txt", "b.txt", "sub"]);
	});

	test("walk visits all entries depth-first", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("a/b");
		await vfs.writeFile("a/x.txt", "x");
		await vfs.writeFile("a/b/y.txt", "y");

		const visited: string[] = [];
		await vfs.walk("a", (path) => {
			visited.push(path);
		});

		expect(visited).toContain("a/b");
		expect(visited).toContain("a/x.txt");
		expect(visited).toContain("a/b/y.txt");
	});

	test("stat returns correct info", async () => {
		const vfs = new MemoryVFS();
		await vfs.mkdirAll("dir");
		await vfs.writeFile("dir/file.txt", "hello");

		const fileInfo = await vfs.stat("dir/file.txt");
		expect(fileInfo.name).toBe("file.txt");
		expect(fileInfo.isFile).toBe(true);
		expect(fileInfo.isDirectory).toBe(false);
		expect(fileInfo.size).toBe(5);

		const dirInfo = await vfs.stat("dir");
		expect(dirInfo.name).toBe("dir");
		expect(dirInfo.isDirectory).toBe(true);
		expect(dirInfo.isFile).toBe(false);
	});

	test("stat throws on missing path", async () => {
		const vfs = new MemoryVFS();
		await expect(vfs.stat("missing")).rejects.toThrow("path not found");
	});

	test("writeFile to root-level file works", async () => {
		const vfs = new MemoryVFS();
		await vfs.writeFile("tmdoc.yaml", "aliases: {}");
		const content = await vfs.readFile("tmdoc.yaml");
		expect(content).toBe("aliases: {}");
	});
});
