import {
	access,
	rename as fsRename,
	writeFile as fsWriteFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { normalizePath } from "./path.js";
import type { FileInfo, VFS, WalkFunc } from "./vfs.js";

/**
 * Disk-backed VFS implementation rooted at an absolute path.
 */
export class BoundVFS implements VFS {
	private readonly rootPath: string;

	constructor(rootPath: string) {
		this.rootPath = resolve(rootPath);
	}

	root(): string {
		return this.rootPath;
	}

	private resolve(path: string): string {
		const norm = normalizePath(path);
		return join(this.rootPath, norm);
	}

	async readFile(path: string): Promise<string> {
		const fullPath = this.resolve(path);
		await this.checkNotSymlink(fullPath);
		return await readFile(fullPath, "utf-8");
	}

	async writeFile(path: string, data: string): Promise<void> {
		const fullPath = this.resolve(path);
		// Atomic write: write to temp, then rename
		const tmpPath = `${fullPath}.tmp-${Date.now()}`;
		await fsWriteFile(tmpPath, data, { mode: 0o644 });
		await fsRename(tmpPath, fullPath);
	}

	async exists(path: string): Promise<boolean> {
		try {
			const fullPath = this.resolve(path);
			await access(fullPath);
			return true;
		} catch {
			return false;
		}
	}

	async isDir(path: string): Promise<boolean> {
		try {
			const fullPath = this.resolve(path);
			const stats = await lstat(fullPath);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	async isFile(path: string): Promise<boolean> {
		try {
			const fullPath = this.resolve(path);
			const stats = await lstat(fullPath);
			return stats.isFile();
		} catch {
			return false;
		}
	}

	async stat(path: string): Promise<FileInfo> {
		const fullPath = this.resolve(path);
		const stats = await lstat(fullPath);
		if (stats.isSymbolicLink()) {
			throw new Error(`symlinks are not allowed: ${path}`);
		}
		const norm = normalizePath(path);
		const parts = norm.split("/");
		return {
			name: parts[parts.length - 1],
			path: norm,
			isDirectory: stats.isDirectory(),
			isFile: stats.isFile(),
			isSymlink: false,
			size: stats.size,
			modifiedAt: stats.mtime,
		};
	}

	async mkdirAll(path: string): Promise<void> {
		const fullPath = this.resolve(path);
		await mkdir(fullPath, { recursive: true, mode: 0o755 });
	}

	async remove(path: string): Promise<void> {
		const fullPath = this.resolve(path);
		await this.checkNotSymlink(fullPath);
		await rm(fullPath);
	}

	async removeAll(path: string): Promise<void> {
		const fullPath = this.resolve(path);
		await rm(fullPath, { recursive: true });
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const oldFull = this.resolve(oldPath);
		const newFull = this.resolve(newPath);
		await fsRename(oldFull, newFull);
	}

	async walk(walkRoot: string, walkFunc: WalkFunc): Promise<void> {
		const norm = normalizePath(walkRoot);
		await this.walkDir(norm, walkFunc);
	}

	async readDir(path: string): Promise<FileInfo[]> {
		const fullPath = this.resolve(path);
		const norm = normalizePath(path);
		const entries = await readdir(fullPath, { withFileTypes: true });
		const result: FileInfo[] = [];

		for (const entry of entries) {
			if (entry.isSymbolicLink()) continue;
			const entryPath = norm === "." ? entry.name : `${norm}/${entry.name}`;
			result.push({
				name: entry.name,
				path: entryPath,
				isDirectory: entry.isDirectory(),
				isFile: entry.isFile(),
				isSymlink: false,
				size: 0,
				modifiedAt: new Date(),
			});
		}

		result.sort((a, b) => a.name.localeCompare(b.name));
		return result;
	}

	private async walkDir(dirPath: string, walkFunc: WalkFunc): Promise<void> {
		const entries = await this.readDir(dirPath);
		for (const entry of entries) {
			await walkFunc(entry.path, entry);
			if (entry.isDirectory) {
				await this.walkDir(entry.path, walkFunc);
			}
		}
	}

	private async checkNotSymlink(fullPath: string): Promise<void> {
		try {
			const stats = await lstat(fullPath);
			if (stats.isSymbolicLink()) {
				throw new Error(`symlinks are not allowed: ${fullPath}`);
			}
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("symlinks")) {
				throw err;
			}
			// File might not exist yet, which is fine
		}
	}
}
