import { join, normalize } from "node:path";

export class PathError extends Error {
	constructor(
		public readonly path: string,
		message: string,
	) {
		super(message);
		this.name = "PathError";
	}
}

/**
 * Normalize and validate a VFS-relative path.
 * Rejects empty, absolute, and parent-traversal paths.
 */
export function normalizePath(path: string): string {
	if (!path || path.trim() === "") {
		throw new PathError(path, "path must not be empty");
	}
	if (path.startsWith("/")) {
		throw new PathError(path, "absolute paths are not allowed");
	}
	// Check for parent traversal before normalizing
	const segments = path.split("/");
	for (const seg of segments) {
		if (seg === "..") {
			throw new PathError(path, "parent traversal (..) is not allowed");
		}
	}
	const cleaned = normalize(path);
	// After normalize, check again
	if (cleaned.startsWith("..")) {
		throw new PathError(path, "parent traversal (..) is not allowed");
	}
	// Remove trailing slashes
	return cleaned.replace(/\/+$/, "");
}

/**
 * Join and normalize path segments for VFS use.
 */
export function joinPath(...segments: string[]): string {
	return normalizePath(join(...segments));
}
