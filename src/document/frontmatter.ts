import { parseDocument, Document as YAMLDocument } from "yaml";

/**
 * Parse a document string into frontmatter metadata and content body.
 * Frontmatter is YAML between `---` delimiters at the start of the file.
 */
export function parseFrontmatter(raw: string): {
	metadata: Record<string, unknown>;
	content: string;
} {
	if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
		return { metadata: {}, content: raw };
	}

	// Handle the case where frontmatter is immediately closed: ---\n---\n
	const startLen = raw.startsWith("---\r\n") ? 5 : 4;
	const endMarkerIdx = raw.indexOf("\n---\n", startLen - 1);
	const endMarkerIdxCR = raw.indexOf("\r\n---\r\n", startLen - 1);

	let yamlEnd: number;
	let contentStart: number;

	if (endMarkerIdx !== -1 && (endMarkerIdxCR === -1 || endMarkerIdx < endMarkerIdxCR)) {
		yamlEnd = endMarkerIdx;
		contentStart = endMarkerIdx + 5; // skip \n---\n
	} else if (endMarkerIdxCR !== -1) {
		yamlEnd = endMarkerIdxCR;
		contentStart = endMarkerIdxCR + 7; // skip \r\n---\r\n
	} else {
		throw new Error("unclosed frontmatter: opening --- with no closing ---");
	}

	const yamlStr = raw.slice(startLen, yamlEnd);
	if (yamlStr.trim() === "") {
		return { metadata: {}, content: stripFrontmatterSeparator(raw.slice(contentStart)) };
	}

	const doc = parseDocument(yamlStr, {
		schema: "core",
		customTags: [],
	});

	// Disable timestamp parsing: convert any Date values back to strings
	const parsed = doc.toJS({ mapAsMap: false }) as Record<string, unknown> | null;
	const metadata = parsed ?? {};
	if (typeof metadata === "object") {
		for (const [key, value] of Object.entries(metadata)) {
			if (value instanceof Date) {
				metadata[key] = value.toISOString();
			}
		}
	}

	const content = stripFrontmatterSeparator(raw.slice(contentStart));
	return { metadata, content };
}

/**
 * Serialize metadata and content into a document string with YAML frontmatter.
 * Field ordering: `_id` first, `_created_at` second, remaining fields alphabetically.
 */
export function serializeFrontmatter(metadata: Record<string, unknown>, content: string): string {
	const persisted = { ...metadata };
	// _title is virtual and derived from markdown content.
	delete persisted._title;

	if (Object.keys(persisted).length === 0) {
		return content;
	}

	const ordered = orderMetadata(persisted);
	const yamlStr = stringifyYaml(ordered);

	let result = `---\n${yamlStr}---\n`;
	if (content.length > 0 && !content.startsWith("\n")) {
		result += "\n";
	}
	result += content;
	return result;
}

function stripFrontmatterSeparator(content: string): string {
	if (content.startsWith("\r\n")) {
		return content.slice(2);
	}
	if (content.startsWith("\n")) {
		return content.slice(1);
	}
	return content;
}

/**
 * Order metadata: _id first, _created_at second, rest alphabetically.
 */
function orderMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
	const ordered: Record<string, unknown> = {};
	if ("_id" in metadata) {
		ordered._id = metadata._id;
	}
	if ("_created_at" in metadata) {
		ordered._created_at = metadata._created_at;
	}
	const remaining = Object.keys(metadata)
		.filter((k) => k !== "_id" && k !== "_created_at")
		.sort();
	for (const key of remaining) {
		ordered[key] = metadata[key];
	}
	return ordered;
}

/**
 * Stringify metadata to YAML, quoting datetime-like strings to prevent
 * YAML parsers from auto-converting them.
 */
function stringifyYaml(metadata: Record<string, unknown>): string {
	const doc = new YAMLDocument();
	doc.contents = doc.createNode(metadata);

	// Walk all scalar nodes and force quoting on values that look like dates/timestamps
	if (doc.contents && "items" in doc.contents) {
		for (const item of (doc.contents as { items: Array<{ value?: unknown }> }).items) {
			forceQuoteScalar(item);
		}
	}

	return doc.toString({ lineWidth: 0 });
}

function forceQuoteScalar(node: unknown): void {
	if (!node || typeof node !== "object") return;

	const n = node as { key?: unknown; value?: unknown; items?: unknown[] };

	if (n.value && typeof n.value === "object" && "value" in n.value) {
		const scalar = n.value as { value: unknown; type?: string };
		if (typeof scalar.value === "string" && looksLikeDatetime(scalar.value)) {
			scalar.type = "QUOTE_DOUBLE";
		}
	}

	// Handle nested maps and sequences
	if (n.value && typeof n.value === "object" && "items" in n.value) {
		const seq = n.value as { items: unknown[] };
		for (const item of seq.items) {
			forceQuoteScalar(item);
			// Handle sequence items directly
			if (item && typeof item === "object" && "value" in item) {
				const scalar = item as { value: unknown; type?: string };
				if (typeof scalar.value === "string" && looksLikeDatetime(scalar.value)) {
					scalar.type = "QUOTE_DOUBLE";
				}
			}
		}
	}
}

function looksLikeDatetime(value: string): boolean {
	// Match ISO 8601 / RFC 3339 patterns
	return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value);
}
