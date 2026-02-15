import { parse, stringify } from "yaml";
import { ulid } from "ulidx";
import { DEFAULT_IGNORE, type RepoConfig } from "./types.js";

const HEADER_COMMENT =
	"# frontdoc repository configuration\n# https://github.com/numtide/frontdoc\n";

/**
 * Parse frontdoc.yaml content into a RepoConfig.
 */
export function parseRepoConfig(content: string): RepoConfig {
	const data = parse(content) as Record<string, unknown> | null;
	if (!data || typeof data !== "object") {
		return { aliases: {}, ignore: [...DEFAULT_IGNORE], extra: {} };
	}

	const repositoryID =
		typeof data.repository_id === "string" && data.repository_id.length > 0
			? data.repository_id
			: undefined;

	const aliases: Record<string, string> = {};
	if (data.aliases && typeof data.aliases === "object") {
		for (const [key, value] of Object.entries(data.aliases as Record<string, unknown>)) {
			if (typeof value === "string") {
				aliases[key] = value;
			}
		}
	}

	let ignore = [...DEFAULT_IGNORE];
	if (Array.isArray(data.ignore)) {
		ignore = data.ignore.filter((v): v is string => typeof v === "string");
	}

	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (key !== "repository_id" && key !== "aliases" && key !== "ignore") {
			extra[key] = value;
		}
	}

	return { repository_id: repositoryID, aliases, ignore, extra };
}

/**
 * Serialize a RepoConfig to frontdoc.yaml content.
 */
export function serializeRepoConfig(config: RepoConfig): string {
	const data: Record<string, unknown> = {
		...config.extra,
		...(config.repository_id ? { repository_id: config.repository_id } : {}),
		aliases: config.aliases,
	};

	// Only include ignore if it differs from defaults
	const defaultIgnore = new Set(DEFAULT_IGNORE);
	const configIgnore = new Set(config.ignore);
	if (
		configIgnore.size !== defaultIgnore.size ||
		[...configIgnore].some((v) => !defaultIgnore.has(v))
	) {
		data.ignore = config.ignore;
	}

	return HEADER_COMMENT + stringify(data, { lineWidth: 0 });
}

/**
 * Create a default frontdoc.yaml content with empty aliases.
 */
export function defaultRepoConfigContent(): string {
	return serializeRepoConfig({
		repository_id: ulid().toLowerCase(),
		aliases: {},
		ignore: [...DEFAULT_IGNORE],
		extra: {},
	});
}
