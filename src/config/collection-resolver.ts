import { resolveAlias } from "./alias.js";
import type { CollectionSchema } from "./types.js";

export function resolveCollection(
	input: string,
	aliases: Record<string, string>,
	schemas: Map<string, CollectionSchema>,
): string {
	return resolveAlias(input, aliases, new Set(schemas.keys()));
}
