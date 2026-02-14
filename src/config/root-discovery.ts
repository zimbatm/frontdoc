import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Find repository root by walking upward for frontdoc.yaml.
 */
export async function findRepositoryRoot(startDir: string): Promise<string> {
	let current = resolve(startDir);

	while (true) {
		const marker = resolve(current, "frontdoc.yaml");
		if (await exists(marker)) {
			return current;
		}

		const parent = dirname(current);
		if (parent === current) {
			throw new Error("repository is not initialized (missing frontdoc.yaml). Run `frontdoc init`.");
		}
		current = parent;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
