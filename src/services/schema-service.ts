import { stringify } from "yaml";
import { resolveAlias } from "../config/alias.js";
import type { CollectionSchema, RepoConfig } from "../config/types.js";

export interface SchemaShowResult {
	aliases: Record<string, string>;
	collections: Record<string, CollectionSchema>;
}

export interface SchemaReadResult {
	collection: string;
	alias: string | null;
	schema: CollectionSchema;
}

export class SchemaService {
	constructor(
		private readonly schemas: Map<string, CollectionSchema>,
		private readonly repoConfig: RepoConfig,
	) {}

	show(): SchemaShowResult {
		const collections: Record<string, CollectionSchema> = {};
		for (const [name, schema] of [...this.schemas.entries()].sort(([a], [b]) =>
			a.localeCompare(b),
		)) {
			collections[name] = schema;
		}

		return {
			aliases: { ...this.repoConfig.aliases },
			collections,
		};
	}

	read(nameOrAlias: string): SchemaReadResult {
		const collection = resolveAlias(
			nameOrAlias,
			this.repoConfig.aliases,
			new Set(this.schemas.keys()),
		);

		const schema = this.schemas.get(collection);
		if (!schema) {
			throw new Error(`collection not found: ${nameOrAlias}`);
		}

		return {
			collection,
			alias: findAliasForCollection(collection, this.repoConfig.aliases),
			schema,
		};
	}
}

export function formatSchemaShowText(result: SchemaShowResult): string {
	const lines: string[] = [];
	lines.push("Aliases:");
	const aliasEntries = Object.entries(result.aliases).sort(([a], [b]) => a.localeCompare(b));
	if (aliasEntries.length === 0) {
		lines.push("  (none)");
	} else {
		for (const [alias, target] of aliasEntries) {
			lines.push(`  ${alias}: ${target}`);
		}
	}

	lines.push("");
	lines.push("Collections:");
	const collectionEntries = Object.entries(result.collections);
	if (collectionEntries.length === 0) {
		lines.push("  (none)");
	} else {
		for (const [name, schema] of collectionEntries) {
			lines.push(`  ${name}: slug=${schema.slug}`);
		}
	}

	return lines.join("\n");
}

export function formatSchemaReadText(result: SchemaReadResult): string {
	const lines: string[] = [];
	lines.push(`Collection: ${result.collection}`);
	lines.push(`Alias: ${result.alias ?? "(none)"}`);
	lines.push("Schema:");
	for (const line of stringify(result.schema, { lineWidth: 0 }).trimEnd().split("\n")) {
		lines.push(`  ${line}`);
	}
	return lines.join("\n");
}

function findAliasForCollection(
	collection: string,
	aliases: Record<string, string>,
): string | null {
	for (const [alias, target] of Object.entries(aliases)) {
		if (target === collection) {
			return alias;
		}
	}
	return null;
}
