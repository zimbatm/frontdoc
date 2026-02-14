import type { CollectionSchema } from "../config/types.js";
import type { Document } from "./document.js";
import { generateFilename, slugify } from "./slug.js";
import { processTemplate } from "./template-engine.js";
import { extractTitleFromContent } from "./document.js";

export function buildTemplateValues(
	fields: Record<string, unknown>,
	schema: CollectionSchema,
	id: string,
	content = "",
): Record<string, string> {
	const shortLength = schema.short_id_length ?? 6;
	const shortID = id.length >= shortLength ? id.slice(-shortLength) : id;
	const values: Record<string, string> = {
		short_id: shortID,
		date: resolveDateString(fields.date),
		_title: extractTitleFromContent(content),
	};

	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === null) continue;
		values[key] = String(value);
	}

	return values;
}

export function generateDocumentFilename(
	schema: CollectionSchema,
	values: Record<string, string>,
): string {
	const rendered = processTemplate(schema.slug, slugifyTemplateValues(values));
	const withShortIDSuffix = appendShortIDSuffix(rendered, values.short_id ?? "");
	return generateFilename(withShortIDSuffix);
}

export function expectedPathForDocument(
	doc: Document,
	schema: CollectionSchema,
	collection: string,
): string {
	const id = String(doc.metadata._id ?? "");
	const values = buildTemplateValues(doc.metadata, schema, id, doc.content);
	const path = `${collection}/${generateDocumentFilename(schema, values)}`;
	return doc.isFolder ? stripMd(path) : path;
}

function slugifyTemplateValues(values: Record<string, string>): Record<string, string> {
	const slugValues: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		slugValues[key] = slugify(value);
	}
	return slugValues;
}

function appendShortIDSuffix(renderedSlug: string, shortID: string): string {
	const id = slugify(shortID);
	if (id.length === 0) {
		return renderedSlug;
	}

	const hadMd = renderedSlug.endsWith(".md");
	const withoutExt = hadMd ? renderedSlug.slice(0, -3) : renderedSlug;
	const segments = withoutExt.split("/");
	const last = segments.length > 0 ? segments[segments.length - 1] : "";

	if (last === id || last.endsWith(`-${id}`)) {
		return renderedSlug;
	}

	segments[segments.length - 1] = last.length > 0 ? `${last}-${id}` : id;
	const rebuilt = segments.join("/");
	return hadMd ? `${rebuilt}.md` : rebuilt;
}

function resolveDateString(value: unknown): string {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	return new Date().toISOString().slice(0, 10);
}

function stripMd(path: string): string {
	return path.endsWith(".md") ? path.slice(0, -3) : path;
}
