/**
 * Slugify a string: lowercase, replace non-alphanumerics with hyphens,
 * collapse consecutive hyphens, trim leading/trailing hyphens.
 */
export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/\//g, "-")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * Generate a filename from a slug template and processed template output.
 * Each path segment is slugified independently. Appends `.md` if not present.
 */
export function generateFilename(slugOutput: string): string {
	// Strip .md before slugifying to avoid it being treated as non-alphanumeric
	let input = slugOutput;
	const hadMd = input.endsWith(".md");
	if (hadMd) {
		input = input.slice(0, -3);
	}

	const segments = input.split("/");
	const slugified = segments.map(slugify);
	let result = slugified.join("/");

	result += ".md";
	const basename = result.slice(result.lastIndexOf("/") + 1);
	if (basename.startsWith(".")) {
		throw new Error("generated filename must not start with '.'");
	}

	return result;
}
