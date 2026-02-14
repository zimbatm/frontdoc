import type { FileHandle } from "node:fs/promises";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Advisory file lock on tmdoc.yaml for write operations.
 */
export class FileLock {
	private handle: FileHandle | null = null;
	private lockPath: string;

	constructor(private readonly rootPath: string) {
		this.lockPath = join(this.rootPath, ".tmdoc.lock");
	}

	/**
	 * Acquire an exclusive advisory lock. Blocks until the lock is available.
	 */
	async acquire(): Promise<void> {
		// Lock-file strategy: create .tmdoc.lock with O_EXCL semantics and wait until available.
		// This provides advisory single-writer coordination across processes.
		while (true) {
			try {
				this.handle = await open(this.lockPath, "wx");
				await this.handle.writeFile(`${process.pid}\n`, "utf8");
				return;
			} catch (err) {
				if (!isAlreadyExists(err)) {
					throw err;
				}
				await sleep(50);
			}
		}
	}

	/**
	 * Release the lock.
	 */
	async release(): Promise<void> {
		if (this.handle) {
			await this.handle.close();
			this.handle = null;
		}
		await rm(this.lockPath, { force: true });
	}
}

function isAlreadyExists(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code?: string }).code === "EEXIST"
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
