/**
 * Well-known alias overrides.
 */
const WELL_KNOWN_ALIASES: Record<string, string> = {
	templates: "tpl",
};

/**
 * Auto-generate an alias from a collection name.
 * 1. Check well-known overrides.
 * 2. Extract up to 3 consonant characters from lowercase name.
 * 3. Fall back to first 3 characters.
 */
export function generateAlias(name: string): string {
	const lower = name.toLowerCase();
	if (lower in WELL_KNOWN_ALIASES) {
		return WELL_KNOWN_ALIASES[lower];
	}

	const consonants = lower.replace(/[^bcdfghjklmnpqrstvwxyz]/g, "");
	if (consonants.length > 0) {
		return consonants.slice(0, 3);
	}

	return lower.slice(0, 3);
}

/**
 * Resolve a collection name or alias to the canonical collection name.
 * Returns the input as-is if no match is found.
 */
export function resolveAlias(
	nameOrAlias: string,
	aliases: Record<string, string>,
	collections: Set<string>,
): string {
	// Direct collection name match
	if (collections.has(nameOrAlias)) {
		return nameOrAlias;
	}

	// Alias match
	if (nameOrAlias in aliases) {
		return aliases[nameOrAlias];
	}

	// Return as-is
	return nameOrAlias;
}
