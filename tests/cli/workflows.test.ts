import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = ["bun", "run", "src/main.ts"];
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

async function runCli(
	args: string[],
	_cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	const proc = Bun.spawn([...CLI, ...args], {
		cwd: PROJECT_ROOT,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, TMDOC_SKIP_EDITOR: "1" },
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

async function runOk(args: string[], cwd: string): Promise<string> {
	const res = await runCli(args, cwd);
	if (res.code !== 0) {
		throw new Error(
			`command failed (${res.code}): ${args.join(" ")}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
		);
	}
	return res.stdout.trim();
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
				"{{short_id}}-{{name}}",
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
			document: { metadata: { id: string } };
		};
		const id = createdJSON.document.metadata.id;
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

		await runOk(["-C", root, "delete", id], root);
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
				"{{short_id}}-{{name}}",
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
				"{{short_id}}-{{name}}",
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
		) as { document: { content: string; metadata: { id: string } } };
		expect(withTemplate.document.content).toContain("Welcome Acme");

		const noTemplate = JSON.parse(
			await runOk(["-C", root, "create", "cli", "Beta", "--no-template", "-o", "json"], root),
		) as { document: { content: string } };
		expect(noTemplate.document.content).not.toContain("Welcome");
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
				"{{short_id}}-{{name}}",
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
			document: { metadata: { id: string } };
		};
		const id = created.document.metadata.id;

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
				"{{short_id}}-{{name}}",
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
				"{{short_id}}-{{name}}",
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
			document: { metadata: { id: string } };
		};
		const short = client.document.metadata.id.slice(-6);
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

		const search = await runOk(["-C", root, "search", "acme", "-o", "json"], root);
		expect(JSON.parse(search).length).toBeGreaterThan(0);

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
});
