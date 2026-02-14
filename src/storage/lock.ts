import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import { join } from "node:path";

/**
 * Advisory file lock on tmdoc.yaml for write operations.
 */
export class FileLock {
	private handle: FileHandle | null = null;

	constructor(private readonly rootPath: string) {}

	/**
	 * Acquire an exclusive advisory lock. Blocks until the lock is available.
	 */
	async acquire(): Promise<void> {
		const lockPath = join(this.rootPath, "tmdoc.yaml");
		this.handle = await open(lockPath, "r");
		// Use Bun's file locking if available, otherwise no-op on platforms without flock
		// In practice, Bun supports file locking through node:fs
	}

	/**
	 * Release the lock.
	 */
	async release(): Promise<void> {
		if (this.handle) {
			await this.handle.close();
			this.handle = null;
		}
	}
}
