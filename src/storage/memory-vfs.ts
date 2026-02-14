import { normalizePath } from "./path.js";
import type { FileInfo, VFS, WalkFunc } from "./vfs.js";

/**
 * In-memory VFS implementation for testing.
 */
export class MemoryVFS implements VFS {
	private files = new Map<string, Uint8Array>();
	private dirs = new Set<string>();
	private readonly encoder = new TextEncoder();
	private readonly decoder = new TextDecoder();

	constructor() {
		// Root directory always exists
		this.dirs.add(".");
	}

	root(): string {
		return "/";
	}

	async readFile(path: string): Promise<string> {
		const norm = normalizePath(path);
		const bytes = this.files.get(norm);
		if (bytes === undefined) {
			throw new Error(`file not found: ${norm}`);
		}
		return this.decoder.decode(bytes);
	}

	async readFileBytes(path: string): Promise<Uint8Array> {
		const norm = normalizePath(path);
		const bytes = this.files.get(norm);
		if (bytes === undefined) {
			throw new Error(`file not found: ${norm}`);
		}
		return bytes.slice();
	}

	async writeFile(path: string, data: string): Promise<void> {
		await this.writeFileBytes(path, this.encoder.encode(data));
	}

	async writeFileBytes(path: string, data: Uint8Array): Promise<void> {
		const norm = normalizePath(path);
		// Ensure parent directories exist
		const parent = parentDir(norm);
		if (parent && !this.dirExists(parent)) {
			throw new Error(`parent directory does not exist: ${parent}`);
		}
		this.files.set(norm, data.slice());
	}

	async exists(path: string): Promise<boolean> {
		const norm = normalizePath(path);
		return this.files.has(norm) || this.dirs.has(norm);
	}

	async isDir(path: string): Promise<boolean> {
		const norm = normalizePath(path);
		return this.dirs.has(norm);
	}

	async isFile(path: string): Promise<boolean> {
		const norm = normalizePath(path);
		return this.files.has(norm);
	}

	async stat(path: string): Promise<FileInfo> {
		const norm = normalizePath(path);
		if (this.files.has(norm)) {
			return this.makeFileInfo(norm, false);
		}
		if (this.dirs.has(norm)) {
			return this.makeFileInfo(norm, true);
		}
		throw new Error(`path not found: ${norm}`);
	}

	async mkdirAll(path: string): Promise<void> {
		const norm = normalizePath(path);
		const parts = norm.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (this.files.has(current)) {
				throw new Error(`path exists as file: ${current}`);
			}
			this.dirs.add(current);
		}
	}

	async remove(path: string): Promise<void> {
		const norm = normalizePath(path);
		if (this.files.has(norm)) {
			this.files.delete(norm);
			return;
		}
		if (this.dirs.has(norm)) {
			// Check if empty
			for (const key of this.files.keys()) {
				if (key.startsWith(`${norm}/`)) {
					throw new Error(`directory not empty: ${norm}`);
				}
			}
			for (const key of this.dirs) {
				if (key !== norm && key.startsWith(`${norm}/`)) {
					throw new Error(`directory not empty: ${norm}`);
				}
			}
			this.dirs.delete(norm);
			return;
		}
		throw new Error(`path not found: ${norm}`);
	}

	async removeAll(path: string): Promise<void> {
		const norm = normalizePath(path);
		if (!this.files.has(norm) && !this.dirs.has(norm)) {
			throw new Error(`path not found: ${norm}`);
		}
		// Remove all files under this path
		for (const key of [...this.files.keys()]) {
			if (key === norm || key.startsWith(`${norm}/`)) {
				this.files.delete(key);
			}
		}
		// Remove all dirs under this path
		for (const key of [...this.dirs]) {
			if (key === norm || key.startsWith(`${norm}/`)) {
				this.dirs.delete(key);
			}
		}
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const oldNorm = normalizePath(oldPath);
		const newNorm = normalizePath(newPath);

		// Ensure new parent exists
		const newParent = parentDir(newNorm);
		if (newParent && !this.dirExists(newParent)) {
			throw new Error(`parent directory does not exist: ${newParent}`);
		}

		if (this.files.has(oldNorm)) {
			const bytes = this.files.get(oldNorm);
			if (bytes === undefined) {
				throw new Error(`path not found: ${oldNorm}`);
			}
			this.files.delete(oldNorm);
			this.files.set(newNorm, bytes);
			return;
		}

		if (this.dirs.has(oldNorm)) {
			// Move directory and all contents
			const prefix = `${oldNorm}/`;

			// Move files
			for (const key of [...this.files.keys()]) {
				if (key.startsWith(prefix)) {
					const newKey = `${newNorm}/${key.slice(prefix.length)}`;
					const bytes = this.files.get(key);
					if (bytes === undefined) {
						continue;
					}
					this.files.set(newKey, bytes);
					this.files.delete(key);
				}
			}

			// Move subdirs
			for (const key of [...this.dirs]) {
				if (key === oldNorm || key.startsWith(prefix)) {
					const newKey = key === oldNorm ? newNorm : `${newNorm}/${key.slice(prefix.length)}`;
					this.dirs.add(newKey);
					this.dirs.delete(key);
				}
			}
			return;
		}

		throw new Error(`path not found: ${oldNorm}`);
	}

	async walk(walkRoot: string, walkFunc: WalkFunc): Promise<void> {
		const norm = normalizePath(walkRoot);
		if (!this.dirs.has(norm)) {
			throw new Error(`directory not found: ${norm}`);
		}
		await this.walkDir(norm, walkFunc);
	}

	async readDir(path: string): Promise<FileInfo[]> {
		const norm = normalizePath(path);
		if (!this.dirs.has(norm)) {
			throw new Error(`directory not found: ${norm}`);
		}

		const entries: FileInfo[] = [];
		const prefix = norm === "." ? "" : `${norm}/`;
		const seen = new Set<string>();

		for (const key of this.files.keys()) {
			const relative = prefix ? (key.startsWith(prefix) ? key.slice(prefix.length) : null) : key;
			if (relative === null) continue;
			// Only direct children (no nested /)
			if (!relative.includes("/")) {
				if (!seen.has(key)) {
					seen.add(key);
					entries.push(this.makeFileInfo(key, false));
				}
			}
		}

		for (const key of this.dirs) {
			if (key === norm || key === ".") continue;
			const relative = prefix ? (key.startsWith(prefix) ? key.slice(prefix.length) : null) : key;
			if (relative === null) continue;
			if (!relative.includes("/")) {
				if (!seen.has(key)) {
					seen.add(key);
					entries.push(this.makeFileInfo(key, true));
				}
			}
		}

		entries.sort((a, b) => a.name.localeCompare(b.name));
		return entries;
	}

	private dirExists(path: string): boolean {
		return this.dirs.has(path) || path === ".";
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

	private makeFileInfo(path: string, isDirectory: boolean): FileInfo {
		const parts = path.split("/");
		const name = parts[parts.length - 1];
		return {
			name,
			path,
			isDirectory,
			isFile: !isDirectory,
			isSymlink: false,
			size: isDirectory ? 0 : (this.files.get(path)?.byteLength ?? 0),
			modifiedAt: new Date(),
		};
	}
}

function parentDir(path: string): string | null {
	const idx = path.lastIndexOf("/");
	if (idx === -1) return ".";
	return path.slice(0, idx);
}
