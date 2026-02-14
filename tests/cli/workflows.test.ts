import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = ["bun", "run", "src/main.ts"];
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

async function runCli(
	args: string[],
	_cwd: string,
	stdinText?: string,
	envOverride?: Record<string, string | undefined>,
): Promise<{ stdout: string; stderr: string; code: number }> {
	const env = {
		...process.env,
		TMDOC_SKIP_EDITOR: "1",
		...envOverride,
	};
	const proc = Bun.spawn([...CLI, ...args], {
		cwd: PROJECT_ROOT,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "pipe",
		env,
	});
	if (stdinText !== undefined) {
		proc.stdin.write(stdinText);
		proc.stdin.end();
	} else {
		proc.stdin.end();
	}
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

async function runOk(
	args: string[],
	cwd: string,
	stdinText?: string,
	envOverride?: Record<string, string | undefined>,
): Promise<string> {
	const res = await runCli(args, cwd, stdinText, envOverride);
	if (res.code !== 0) {
		throw new Error(
			`command failed (${res.code}): ${args.join(" ")}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
		);
	}
	return res.stdout.trim();
}

async function runFail(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
	const res = await runCli(args, cwd);
	if (res.code === 0) {
		throw new Error(`expected command to fail: ${args.join(" ")}\nstdout:\n${res.stdout}`);
	}
	return { stdout: res.stdout, stderr: res.stderr };
}

describe("CLI workflows", () => {
	test("init + schema + create/read/update/delete lifecycle", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-"));

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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-template-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-open-template-"));
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
			TMDOC_SKIP_EDITOR: "0",
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-open-unchanged-draft-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-open-missing-defaults-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-open-keep-draft-"));
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
			TMDOC_SKIP_EDITOR: "0",
		});
		expect(output).toContain(".tdo-");
		const list = JSON.parse(
			await runOk(["-C", root, "list", "cli", "-o", "json"], root),
		) as unknown[];
		expect(list).toHaveLength(0);
	});

	test("open does not prompt for template when slug match already exists", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-open-existing-no-prompt-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-template-prompt-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-attach-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-search-"));
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
		expect(graph).toContain("digraph tmdoc");

		const stats = JSON.parse(await runOk(["-C", root, "stats", "-o", "json"], root)) as {
			total: number;
		};
		expect(stats.total).toBe(2);
	});

	test("schema rename and delete flow through CLI", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-schema-"));
		await runOk(["-C", root, "init"], root);
		await runOk(["-C", root, "schema", "create", "clients", "--prefix", "cli"], root);
		await runOk(["-C", root, "schema", "rename", "clients", "customers"], root);

		const schemaRead = await runOk(["-C", root, "schema", "read", "customers", "-o", "json"], root);
		expect(JSON.parse(schemaRead).collection).toBe("customers");

		await runOk(["-C", root, "schema", "delete", "customers", "--force"], root);
		const rootConfig = await readFile(join(root, "tmdoc.yaml"), "utf8");
		expect(rootConfig).not.toContain("customers");
	});

	test("update can read replacement content from stdin", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-stdin-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-delete-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-open-"));
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
			TMDOC_SKIP_EDITOR: "0",
			COUNT_FILE: countFile,
		});
		expect(output).toContain("Validation issues found:");

		const raw = await runOk(["-C", root, "read", id, "-o", "raw"], root);
		expect(raw).toContain("name: Repaired Name");
	});

	test("check prints details only with --verbose", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-check-verbose-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-skip-validation-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-list-table-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-date-input-"));
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
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-create-prompt-"));
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

	test("web server serves API and honors -C", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-"));
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
		await runOk(["-C", root, "create", "cli", "Acme"], root);

		const proc = Bun.spawn(
			[...CLI, "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
			{
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					TMDOC_SKIP_EDITOR: "1",
				},
			},
		);

		try {
			const url = await waitForWebUrl(proc.stdout);
			const collectionsResp = await fetch(new URL("/api/collections", url));
			expect(collectionsResp.status).toBe(200);
			const collections = (await collectionsResp.json()) as {
				collections: Array<{ name: string; count: number }>;
			};
			expect(collections.collections.some((c) => c.name === "clients")).toBe(true);
			expect(collections.collections.some((c) => c.name === "clients" && c.count === 1)).toBe(true);

			const docsResp = await fetch(new URL("/api/documents?collection=cli", url));
			expect(docsResp.status).toBe(200);
			const docs = (await docsResp.json()) as {
				documents: Array<{ title: string }>;
			};
			expect(docs.documents.some((d) => d.title.includes("Acme"))).toBe(true);
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});

	test("web attachment API uploads dropped files and appends markdown reference", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-attachments-"));
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
		await runOk(["-C", root, "create", "cli", "Acme"], root);

		const proc = Bun.spawn(
			[...CLI, "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
			{
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					TMDOC_SKIP_EDITOR: "1",
				},
			},
		);

		try {
			const url = await waitForWebUrl(proc.stdout);
			const docsResp = await fetch(new URL("/api/documents?collection=cli", url));
			expect(docsResp.status).toBe(200);
			const docs = (await docsResp.json()) as {
				documents: Array<{ id: string }>;
			};
			expect(docs.documents).toHaveLength(1);
			const id = docs.documents[0].id;

			const payload = new FormData();
			payload.set("file", new File(["Attachment body"], "notes.txt", { type: "text/plain" }));
			payload.set("reference", "true");
			const uploadResp = await fetch(new URL(`/api/documents/${encodeURIComponent(id)}/attachments`, url), {
				method: "POST",
				body: payload,
			});
			expect(uploadResp.status).toBe(201);
			const uploaded = (await uploadResp.json()) as {
				path: string;
			};
			expect(uploaded.path.endsWith("/notes.txt")).toBe(true);

			const readResp = await fetch(new URL(`/api/documents/${encodeURIComponent(id)}`, url));
			expect(readResp.status).toBe(200);
			const read = (await readResp.json()) as {
				document: { content: string; path: string };
			};
			expect(read.document.path.endsWith(".md")).toBe(false);
			expect(read.document.content).toContain("[notes.txt](notes.txt)");
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});

	test("web server serves SPA shell and static UI bundle", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-ui-shell-"));
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
		await runOk(["-C", root, "create", "cli", "Acme"], root);

		const proc = Bun.spawn(
			[...CLI, "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
			{
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					TMDOC_SKIP_EDITOR: "1",
				},
			},
		);

		try {
			const url = await waitForWebUrl(proc.stdout);
			const shellResp = await fetch(url);
			expect(shellResp.status).toBe(200);
			const shellHtml = await shellResp.text();
			expect(shellHtml).toContain('id="app"');
			expect(shellHtml).toContain("/ui/main.js");

			const jsResp = await fetch(new URL("/ui/main.js", url));
			expect(jsResp.status).toBe(200);
			const jsContentType = jsResp.headers.get("content-type") ?? "";
			expect(jsContentType).toContain("javascript");
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});

	test("web server redirects legacy id document routes to canonical slug routes", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-slug-route-"));
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
		await runOk(["-C", root, "create", "con", "Alice Example"], root);

		const proc = Bun.spawn(
			[...CLI, "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
			{
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					TMDOC_SKIP_EDITOR: "1",
				},
			},
		);

		try {
			const url = await waitForWebUrl(proc.stdout);
			const docsResp = await fetch(new URL("/api/documents?collection=contacts", url));
			expect(docsResp.status).toBe(200);
			const docs = (await docsResp.json()) as {
				documents: Array<{ id: string; collection: string; path: string }>;
			};
			expect(docs.documents).toHaveLength(1);
			const doc = docs.documents[0];
			const slug = slugFromPath(doc.collection, doc.path);

			const legacyUrl = new URL(
				`/c/${encodeURIComponent(doc.collection)}/${encodeURIComponent(doc.id)}`,
				url,
			);
			const legacyResp = await fetch(legacyUrl, { redirect: "manual" });
			expect(legacyResp.status).toBe(302);
			const location = legacyResp.headers.get("location");
			expect(location).toBe(`/c/${encodeURIComponent(doc.collection)}/${encodeURIComponent(slug)}`);
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});

	test("web create API uses open-style draft lifecycle and reopens existing slug target", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-open-defaults-"));
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
				"--default",
				"Untitled Client",
			],
			root,
		);

		const proc = Bun.spawn(
			[...CLI, "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
			{
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					TMDOC_SKIP_EDITOR: "1",
				},
			},
		);

		try {
			const url = await waitForWebUrl(proc.stdout);
			const createResp = await fetch(new URL("/api/documents", url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collection: "cli", openDefaults: true }),
			});
			expect(createResp.status).toBe(201);
			const created = (await createResp.json()) as {
				document: { id: string; collection: string; path: string };
			};
			expect(created.document.collection).toBe("clients");
			expect(created.document.path).toContain("/.tdo-");

			const docsBeforeSaveResp = await fetch(new URL("/api/documents?collection=cli", url));
			expect(docsBeforeSaveResp.status).toBe(200);
			const docsBeforeSave = (await docsBeforeSaveResp.json()) as {
				documents: Array<{ id: string }>;
			};
			expect(docsBeforeSave.documents).toHaveLength(0);

			const saveResp = await fetch(
				new URL(`/api/documents/${encodeURIComponent(created.document.id)}`, url),
				{
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						fields: { name: "Untitled Client" },
						content: "Created from draft.\n",
					}),
				},
			);
			expect(saveResp.status).toBe(200);
			const saved = (await saveResp.json()) as {
				document: { id: string; path: string };
			};
			expect(saved.document.path.startsWith("clients/")).toBe(true);
			expect(saved.document.path.includes("/.tdo-")).toBe(false);

			const reopenResp = await fetch(new URL("/api/documents", url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collection: "clients", openDefaults: true }),
			});
			expect(reopenResp.status).toBe(200);
			const reopened = (await reopenResp.json()) as {
				document: { id: string };
			};
			expect(reopened.document.id).toBe(saved.document.id);
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});

	test("web create API stages draft when slug variables have no defaults", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-open-missing-defaults-"));
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

		const proc = Bun.spawn(
			[...CLI, "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
			{
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					TMDOC_SKIP_EDITOR: "1",
				},
			},
		);

		try {
			const url = await waitForWebUrl(proc.stdout);
			const createResp = await fetch(new URL("/api/documents", url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collection: "con", openDefaults: true }),
			});
			expect(createResp.status).toBe(201);
			const created = (await createResp.json()) as {
				document: { id: string; path: string; draft?: boolean };
			};
			expect(created.document.path).toContain("/.tdo-");
			expect(created.document.draft).toBe(true);
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});

	test("web server supports multiple --collection flags as allowlist", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-scope-"));
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
				"journal",
				"--prefix",
				"jrn",
				"--slug",
				"journal-{{date}}-{{short_id}}",
			],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "journal", "date", "--type", "date", "--required"],
			root,
		);
		await runOk(["-C", root, "create", "cli", "Acme"], root);
		await runOk(["-C", root, "create", "jrn", "-f", `date=${dateOffsetISO(0)}`], root);

		const proc = Bun.spawn(
			[
				...CLI,
				"-C",
				root,
				"web",
				"--host",
				"127.0.0.1",
				"--port",
				"0",
				"--no-open",
				"--collection",
				"cli",
				"--collection",
				"jrn",
			],
			{
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					TMDOC_SKIP_EDITOR: "1",
				},
			},
		);

		try {
			const url = await waitForWebUrl(proc.stdout);
			const collectionsResp = await fetch(new URL("/api/collections", url));
			expect(collectionsResp.status).toBe(200);
			const collections = (await collectionsResp.json()) as {
				collections: Array<{ name: string }>;
			};
			expect(collections.collections.map((c) => c.name).sort()).toEqual(["clients", "journal"]);

			const disallowedResp = await fetch(new URL("/api/documents?collection=templates", url));
			expect(disallowedResp.status).toBe(200);
			const disallowed = (await disallowedResp.json()) as {
				documents: unknown[];
			};
			expect(disallowed.documents).toHaveLength(0);
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});
});

function dateOffsetISO(offsetDays: number): string {
	const now = new Date();
	const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const shifted = new Date(utcMidnight + offsetDays * 24 * 60 * 60 * 1000);
	return shifted.toISOString().slice(0, 10);
}

async function waitForWebUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const match = buffer.match(/http:\/\/[^\s]+/);
		if (match) {
			return match[0];
		}
	}
	throw new Error(`timed out waiting for web URL. output=${buffer}`);
}

function slugFromPath(collection: string, path: string): string {
	const prefix = `${collection}/`;
	const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	return relative.endsWith(".md") ? relative.slice(0, -3) : relative;
}
