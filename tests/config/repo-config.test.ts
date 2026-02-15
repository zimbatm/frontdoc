import { describe, expect, test } from "bun:test";
import {
	defaultRepoConfigContent,
	parseRepoConfig,
	serializeRepoConfig,
} from "../../src/config/repo-config.js";

describe("repo-config", () => {
	test("parse reads repository_id when present", () => {
		const parsed = parseRepoConfig("repository_id: 01arz3ndektsv4rrffq69g5fav\naliases: {}\n");
		expect(parsed.repository_id).toBe("01arz3ndektsv4rrffq69g5fav");
	});

	test("parse leaves repository_id undefined when absent", () => {
		const parsed = parseRepoConfig("aliases: {}\n");
		expect(parsed.repository_id).toBeUndefined();
	});

	test("serialize writes repository_id when present", () => {
		const raw = serializeRepoConfig({
			repository_id: "01arz3ndektsv4rrffq69g5fav",
			aliases: { cli: "clients" },
			ignore: [".DS_Store", "Thumbs.db"],
			extra: {},
		});
		expect(raw).toContain("repository_id: 01arz3ndektsv4rrffq69g5fav");
	});

	test("default config includes repository_id", () => {
		const raw = defaultRepoConfigContent();
		expect(raw).toContain("repository_id:");
	});
});
