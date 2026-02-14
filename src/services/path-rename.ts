import { dirname } from "node:path";
import type { VFS } from "../storage/vfs.js";

export async function renamePathIfNeeded(
	vfs: VFS,
	currentPath: string,
	targetPath: string,
): Promise<string> {
	if (targetPath === currentPath) {
		return currentPath;
	}

	const parent = dirname(targetPath);
	if (parent !== ".") {
		await vfs.mkdirAll(parent);
	}
	await vfs.rename(currentPath, targetPath);
	return targetPath;
}
