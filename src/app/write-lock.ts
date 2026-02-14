import type { Manager } from "../manager.js";
import { FileLock } from "../storage/lock.js";

export async function withWriteLock<T>(manager: Manager, fn: () => Promise<T>): Promise<T> {
	const lock = new FileLock(manager.RootPath());
	await lock.acquire();
	try {
		return await fn();
	} finally {
		await lock.release();
	}
}
