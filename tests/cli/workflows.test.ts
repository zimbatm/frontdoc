import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFail, runOk } from "./test-utils.js";

describe("CLI workflows", () => {
	test("FRONTDOC_DIRECTORY acts like -C when flag is omitted", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-envdir-"));

		await runOk(["init"], root, undefined, { FRONTDOC_DIRECTORY: root });
		await runOk(
			[
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
			undefined,
			{ FRONTDOC_DIRECTORY: root },
		);
		await runOk(
			["schema", "field", "create", "cli", "name", "--type", "string", "--required"],
			root,
			undefined,
			{ FRONTDOC_DIRECTORY: root },
		);

		const created = JSON.parse(
			await runOk(["create", "cli", "Acme Corp", "-o", "json"], root, undefined, {
				FRONTDOC_DIRECTORY: root,
			}),
		) as { path: string };
		expect(created.path.startsWith("clients/")).toBe(true);
	});

	test("directory flag takes precedence over FRONTDOC_DIRECTORY", async () => {
		const rootA = await mkdtemp(join(tmpdir(), "frontdoc-cli-dir-a-"));
		const rootB = await mkdtemp(join(tmpdir(), "frontdoc-cli-dir-b-"));

		await runOk(["-C", rootA, "init"], rootA);
		await runOk(["-C", rootB, "init"], rootB);
		await runOk(["-C", rootA, "schema", "create", "clients", "--prefix", "cli"], rootA);
		await runOk(["-C", rootB, "schema", "create", "projects", "--prefix", "prj"], rootB);

		const shown = JSON.parse(
			await runOk(["-C", rootA, "schema", "show", "-o", "json"], rootA, undefined, {
				FRONTDOC_DIRECTORY: rootB,
			}),
		) as { collections: Record<string, unknown> };
		expect(shown.collections.clients).toBeDefined();
		expect(shown.collections.projects).toBeUndefined();
	});

	test("init + schema + create/read/update/delete lifecycle", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-"));

		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "cli", "name", "--type", "string", "--required"],
			root,
		);

		const created = await runOk(["-C", root, "create", "cli", "Acme Corp", "-o", "json"], root);
		const createdJSON = JSON.parse(created) as {
			path: string;
			document: { metadata: { _id: string } };
		};
		const id = createdJSON.document.metadata._id;
		expect(createdJSON.path.startsWith("clients/")).toBe(true);

		const raw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(raw).toContain("Acme Corp");

		const updatedPath = await runOk(
			["-C", root, "update", id, "-f", "name=Beta Corp", "-o", "path"],
			root,
		);
		expect(updatedPath).toContain("beta-corp");

		const listed = await runOk(["-C", root, "list", "cli", "-o", "json"], root);
		const listedJSON = JSON.parse(listed) as Array<{ path: string }>;
		expect(listedJSON).toHaveLength(1);
		expect(listedJSON[0].path).toContain("beta-corp");

		await runOk(["-C", root, "delete", id, "--force"], root);
		const listedAfter = await runOk(["-C", root, "list", "cli", "-o", "json"], root);
		expect(JSON.parse(listedAfter)).toEqual([]);
	});

	test("templates are applied by create flags", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-template-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"templates",
				"--prefix",
				"tpl",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"create",
				"templates",
				"Client Onboarding",
				"-f",
				"name=Client Onboarding",
				"-f",
				"for=clients",
				"--content",
				"# Welcome {{name}}",
				"-o",
				"path",
			],
			root,
		);

		const withTemplate = JSON.parse(
			await runOk(
				["-C", root, "create", "cli", "Acme", "--template", "Client Onboarding", "-o", "json"],
				root,
			),
		) as { document: { content: string; metadata: { _id: string } } };
		expect(withTemplate.document.content).toContain("Welcome Acme");

		const noTemplate = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Beta", "--no-template", "-o", "json"], root),
		) as { document: { content: string } };
		expect(noTemplate.document.content).not.toContain("Welcome");
	});

	test("open applies template on first create only", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-open-template-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"templates",
				"--prefix",
				"tpl",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"create",
				"templates",
				"Client Journal",
				"-f",
				"name=Client Journal",
				"-f",
				"for=clients",
				"--content",
				"# Hello {{name}}",
				"-o",
				"path",
			],
			root,
		);

		const editorScript = join(root, "append-editor.sh");
		await writeFile(
			editorScript,
			`#!/usr/bin/env bash
set -euo pipefail
echo "\\nseeded" >>"$1"
`,
			{ mode: 0o755 },
		);
		const createdPath = await runOk(["-C", root, "open", "cli", "Acme"], root, undefined, {
			EDITOR: editorScript,
			FRONTDOC_SKIP_EDITOR: "0",
		});
		expect(createdPath).toContain("acme-");
		expect(createdPath).toContain(".md");
		const listed = JSON.parse(
			await runOk(["-C", root, "list", "cli", "-o", "json"], root),
		) as Array<{
			document: { metadata: { _id: string } };
		}>;
		expect(listed).toHaveLength(1);
		const id = listed[0].document.metadata._id;
		const createdRaw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(createdRaw).toContain("# Hello Acme");

		await runOk(["-C", root, "update", id, "--content", "# Custom body", "-o", "path"], root);
		await runOk(["-C", root, "open", "cli", "Acme"], root);
		const reopenedRaw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(reopenedRaw).toContain("# Custom body");
		expect(reopenedRaw).not.toContain("# Hello Acme");
	});

	test("open does not create missing slug target when draft is unchanged", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-open-unchanged-draft-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"journal",
				"--prefix",
				"jrn",
				"--slug",
				"journal-{{date}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"journal",
				"date",
				"--type",
				"date",
				"--required",
				"--default",
				"today",
			],
			root,
		);

		const output = await runOk(["-C", root, "open", "jrn"], root);
		expect(output).toBe("");
		const list = JSON.parse(
			await runOk(["-C", root, "list", "jrn", "-o", "json"], root),
		) as unknown[];
		expect(list).toHaveLength(0);
	});

	test("open without slug defaults stages draft instead of failing", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-open-missing-defaults-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"contacts",
				"--prefix",
				"con",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"contacts",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);

		const out = await runOk(["-C", root, "open", "con"], root);
		expect(out).toBe("");
	});

	test("open can keep invalid draft without creating target document", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-open-keep-draft-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		const editorScript = join(root, "invalid-editor.sh");
		await writeFile(
			editorScript,
			`#!/usr/bin/env bash
set -euo pipefail
target="$1"
id_line="$(grep '^_id:' "$target" | head -n1 | cut -d' ' -f2-)"
created_line="$(grep '^_created_at:' "$target" | head -n1 | cut -d' ' -f2-)"
cat >"$target" <<EOF
---
_id: $id_line
_created_at: $created_line
---

invalid
EOF
`,
			{ mode: 0o755 },
		);

		const output = await runOk(["-C", root, "open", "cli", "Acme"], root, "2\n", {
			EDITOR: editorScript,
			FRONTDOC_SKIP_EDITOR: "0",
		});
		expect(output).toContain(".tdo-");
		const list = JSON.parse(
			await runOk(["-C", root, "list", "cli", "-o", "json"], root),
		) as unknown[];
		expect(list).toHaveLength(0);
	});

	test("open does not prompt for template when slug match already exists", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-open-existing-no-prompt-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"templates",
				"--prefix",
				"tpl",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"create",
				"templates",
				"Template A",
				"-f",
				"name=Template A",
				"-f",
				"for=clients",
				"--content",
				"# A {{name}}",
				"-o",
				"path",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"create",
				"templates",
				"Template B",
				"-f",
				"name=Template B",
				"-f",
				"for=clients",
				"--content",
				"# B {{name}}",
				"-o",
				"path",
			],
			root,
		);
		const created = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Acme", "--no-template", "-o", "json"], root),
		) as { path: string };

		const openedPath = await runOk(["-C", root, "open", "cli", "Acme"], root);
		expect(openedPath).toBe(created.path);
	});

	test("create prompts for template selection when multiple templates exist", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-template-prompt-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"templates",
				"--prefix",
				"tpl",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"create",
				"templates",
				"Template One",
				"-f",
				"name=Template One",
				"-f",
				"for=clients",
				"--content",
				"# ONE {{name}}",
				"-o",
				"path",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"create",
				"templates",
				"Template Two",
				"-f",
				"name=Template Two",
				"-f",
				"for=clients",
				"--content",
				"# TWO {{name}}",
				"-o",
				"path",
			],
			root,
		);

		const createOut = await runOk(["-C", root, "create", "cli", "Acme", "-o", "path"], root, "2\n");
		const pathMatch = createOut.match(/([a-z0-9_/-]+\.md)\s*$/);
		expect(pathMatch).not.toBeNull();
		const createdPath = pathMatch?.[1] ?? "";
		const rawCreated = await readFile(join(root, createdPath), "utf8");
		expect(rawCreated).toMatch(/# (ONE|TWO) Acme/);
	});

	test("attach + check --fix --prune-attachments collapses folder", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-attach-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		const created = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Acme", "-o", "json"], root),
		) as {
			path: string;
			document: { metadata: { _id: string } };
		};
		const id = created.document.metadata._id;

		const hostAttachment = join(root, "attach.txt");
		await writeFile(hostAttachment, "hello", "utf8");
		await runOk(["-C", root, "attach", id, hostAttachment, "--no-reference", "-o", "path"], root);

		const check = JSON.parse(
			await runOk(["-C", root, "check", "cli", "--fix", "--prune-attachments", "-o", "json"], root),
		) as { fixed: number };
		expect(check.fixed).toBeGreaterThan(0);

		const list = JSON.parse(await runOk(["-C", root, "list", "cli", "-o", "json"], root)) as Array<{
			path: string;
		}>;
		expect(list[0].path.endsWith(".md")).toBe(true);
	});

	test("search/relationships/graph/stats produce outputs", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-search-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(["-C", root, "schema", "field", "create", "clients", "name", "--required"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"projects",
				"--prefix",
				"prj",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(["-C", root, "schema", "field", "create", "projects", "name", "--required"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"projects",
				"client_id",
				"--type",
				"reference",
				"--target",
				"clients",
			],
			root,
		);

		const client = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Acme", "-o", "json"], root),
		) as {
			document: { metadata: { _id: string } };
		};
		const short = client.document.metadata._id.slice(-6);
		await runOk(
			[
				"-C",
				root,
				"create",
				"prj",
				"Roadmap",
				"-f",
				`client_id=${short}`,
				"-f",
				`notes=See [[${short}:Acme]]`,
			],
			root,
		);

		const search = await runOk(["-C", root, "search", "acme", "-n", "1", "-o", "json"], root);
		expect(JSON.parse(search).length).toBe(1);

		const listed = await runOk(["-C", root, "list", "clients", "name:Acme", "-o", "json"], root);
		const listedJson = JSON.parse(listed) as Array<{ path: string }>;
		expect(listedJson).toHaveLength(1);
		expect(listedJson[0].path).toContain("clients/");

		const rel = await runOk(["-C", root, "relationships", short, "-o", "json"], root);
		const relJSON = JSON.parse(rel) as { incoming: unknown[] };
		expect(relJSON.incoming.length).toBeGreaterThan(0);

		const graph = await runOk(["-C", root, "graph", "-o", "dot"], root);
		expect(graph).toContain("digraph frontdoc");

		const stats = JSON.parse(await runOk(["-C", root, "stats", "-o", "json"], root)) as {
			total: number;
		};
		expect(stats.total).toBe(2);
	});

	test("schema rename and delete flow through CLI", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-schema-"));
		await runOk(["-C", root, "init"], root);
		await runOk(["-C", root, "schema", "create", "clients", "--prefix", "cli"], root);
		await runOk(["-C", root, "schema", "rename", "clients", "customers"], root);

		const schemaRead = await runOk(["-C", root, "schema", "read", "customers", "-o", "json"], root);
		expect(JSON.parse(schemaRead).collection).toBe("customers");

		await runOk(["-C", root, "schema", "delete", "customers", "--force"], root);
		const rootConfig = await readFile(join(root, "frontdoc.yaml"), "utf8");
		expect(rootConfig).not.toContain("customers");
	});

	test("update can read replacement content from stdin", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-stdin-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(["-C", root, "schema", "field", "create", "clients", "name", "--required"], root);
		const created = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Acme", "-o", "json"], root),
		) as {
			document: { metadata: { _id: string } };
		};
		const id = created.document.metadata._id;

		await runOk(["-C", root, "update", id, "--content", "-", "-o", "json"], root, "# From stdin\n");
		const raw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(raw).toContain("# From stdin");
	});

	test("delete prompts for confirmation unless --force", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-delete-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(["-C", root, "schema", "field", "create", "clients", "name", "--required"], root);
		const created = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Acme", "-o", "json"], root),
		) as {
			document: { metadata: { _id: string } };
		};
		const id = created.document.metadata._id;

		const aborted = await runOk(["-C", root, "delete", id], root, "n\n");
		expect(aborted).toContain("Aborted");
		const listedAfterAbort = JSON.parse(
			await runOk(["-C", root, "list", "cli", "-o", "json"], root),
		) as Array<{
			path: string;
		}>;
		expect(listedAfterAbort).toHaveLength(1);

		await runOk(["-C", root, "delete", id], root, "y\n");
		const listedAfterDelete = JSON.parse(
			await runOk(["-C", root, "list", "cli", "-o", "json"], root),
		);
		expect(listedAfterDelete).toEqual([]);
	});

	test("open validates after edit and can re-open editor", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-open-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(["-C", root, "schema", "field", "create", "clients", "name", "--required"], root);
		const created = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Acme", "-o", "json"], root),
		) as {
			document: { metadata: { _id: string } };
			path: string;
		};
		const id = created.document.metadata._id;
		const shortID = id.slice(-6);

		const editorScript = join(root, "fake-editor.sh");
		const countFile = join(root, ".edit-count");
		await writeFile(
			editorScript,
			`#!/usr/bin/env bash
set -euo pipefail
target="$1"
count_file="\${COUNT_FILE:?}"
count=0
if [ -f "$count_file" ]; then
  count="$(cat "$count_file")"
fi
id_line="$(grep '^_id:' "$target" | head -n1 | cut -d' ' -f2-)"
created_line="$(grep '^_created_at:' "$target" | head -n1 | cut -d' ' -f2-)"
if [ "$count" = "0" ]; then
  cat >"$target" <<EOF
---
_id: $id_line
_created_at: $created_line
---

invalid
EOF
  echo 1 >"$count_file"
else
  cat >"$target" <<EOF
---
_id: $id_line
_created_at: $created_line
name: Repaired Name
---

valid
EOF
fi
`,
			{ mode: 0o755 },
		);

		const output = await runOk(["-C", root, "open", "cli", shortID], root, "y\n", {
			EDITOR: editorScript,
			FRONTDOC_SKIP_EDITOR: "0",
			COUNT_FILE: countFile,
		});
		expect(output).toContain("Validation issues found:");

		const raw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(raw).toContain("name: Repaired Name");
	});

	test("check prints details only with --verbose", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-check-verbose-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		const created = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Acme", "-o", "json"], root),
		) as {
			document: { metadata: { _id: string } };
		};
		const shortID = created.document.metadata._id.slice(-6);
		await runOk(
			[
				"-C",
				root,
				"create",
				"cli",
				"Broken",
				"--content",
				`[[${shortID}x:Missing]]`,
				"--skip-validation",
			],
			root,
		);

		const plain = await runOk(["-C", root, "check"], root);
		expect(plain).not.toContain("ERROR ");
		expect(plain).toContain("Issues:");

		const verbose = await runOk(["-C", root, "check", "--verbose"], root);
		expect(verbose).toContain("ERROR ");
		expect(verbose).toContain("broken wiki-style link");
	});

	test("create/update validate by default and support --skip-validation", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-skip-validation-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"clients",
				"name",
				"--type",
				"string",
				"--required",
			],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "clients", "currency", "--type", "currency"],
			root,
		);

		const createFail = await runFail(
			["-C", root, "create", "cli", "BadCurrency", "-f", "currency=usd"],
			root,
		);
		expect(createFail.stderr).toContain("validation failed");

		const created = JSON.parse(
			await runOk(
				[
					"-C",
					root,
					"create",
					"cli",
					"SkipValidation",
					"-f",
					"currency=usd",
					"--skip-validation",
					"-o",
					"json",
				],
				root,
			),
		) as {
			document: { metadata: { _id: string } };
		};
		const id = created.document.metadata._id;

		const updateFail = await runFail(["-C", root, "update", id, "-f", "currency=eur"], root);
		expect(updateFail.stderr).toContain("validation failed");

		await runOk(
			["-C", root, "update", id, "-f", "currency=eur", "--skip-validation", "-o", "path"],
			root,
		);
		const raw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(raw).toContain("currency: eur");
	});

	test("list table output includes headers and fields", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-list-table-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"clients",
				"--prefix",
				"cli",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(["-C", root, "schema", "field", "create", "clients", "name", "--required"], root);
		await runOk(["-C", root, "create", "cli", "Acme"], root);

		const table = await runOk(["-C", root, "list", "cli", "-o", "table"], root);
		expect(table).toContain("PATH");
		expect(table).toContain("COLLECTION");
		expect(table).toContain("ID");
		expect(table).toContain("NAME");
		expect(table).toContain("clients/");
		expect(table).toContain("Acme");
	});

	test("date and datetime shorthand inputs are normalized", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-date-input-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"create",
				"tasks",
				"--prefix",
				"tsk",
				"--slug",
				"{{name}}-{{short_id}}",
			],
			root,
		);
		await runOk(["-C", root, "schema", "field", "create", "tasks", "name", "--required"], root);
		await runOk(
			["-C", root, "schema", "field", "create", "tasks", "due_date", "--type", "date"],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "tasks", "starts_at", "--type", "datetime"],
			root,
		);

		const created = JSON.parse(
			await runOk(
				[
					"-C",
					root,
					"create",
					"tsk",
					"Release",
					"-f",
					"due_date=today",
					"-f",
					"starts_at=+1",
					"-o",
					"json",
				],
				root,
			),
		) as {
			document: { metadata: { _id: string } };
		};
		const id = created.document.metadata._id;
		const raw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(raw).toContain(`due_date: "${dateOffsetISO(0)}"`);
		expect(raw).toContain(`starts_at: "${dateOffsetISO(1)}T00:00:00Z"`);

		await runOk(["-C", root, "update", id, "-f", "due_date=-2"], root);
		const rawUpdated = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(rawUpdated).toContain(`due_date: "${dateOffsetISO(-2)}"`);
	});

	test("create prompts to choose collection when omitted", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-create-prompt-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			["-C", root, "schema", "create", "clients", "--prefix", "cli", "--slug", "{{short_id}}"],
			root,
		);
		await runOk(
			["-C", root, "schema", "create", "projects", "--prefix", "prj", "--slug", "{{short_id}}"],
			root,
		);

		const out = await runOk(["-C", root, "create", "-o", "path"], root, "2\n");
		const pathMatch = out.match(/([a-z0-9_/-]+\.md)\s*$/);
		expect(pathMatch).not.toBeNull();
		expect(pathMatch?.[1].startsWith("projects/")).toBe(true);
	});

	test("create prompts for missing required fields in weight order", async () => {
		const root = await mkdtemp(join(tmpdir(), "frontdoc-cli-create-required-prompt-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			["-C", root, "schema", "create", "contacts", "--prefix", "ctc", "--slug", "{{short_id}}"],
			root,
		);
		await runOk(
			[
				"-C",
				root,
				"schema",
				"field",
				"create",
				"contacts",
				"email",
				"--type",
				"email",
				"--required",
				"--weight",
				"30",
			],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "contacts", "name", "--required", "--weight", "10"],
			root,
		);

		const out = await runOk(
			["-C", root, "create", "ctc", "-o", "json"],
			root,
			"Alice Example\nalice@example.com\n",
		);

		const created = JSON.parse(out) as {
			document: { metadata: { _id: string } };
		};
		const raw = await runOk(["-C", root, "read", created.document.metadata._id, "-o", "raw"], root);
		expect(raw).toContain("name: Alice Example");
		expect(raw).toContain("email: alice@example.com");
	});
});

function dateOffsetISO(offsetDays: number): string {
	const now = new Date();
	const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const shifted = new Date(utcMidnight + offsetDays * 24 * 60 * 60 * 1000);
	return shifted.toISOString().slice(0, 10);
}
