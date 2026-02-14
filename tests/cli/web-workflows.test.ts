import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOk, slugFromPath, spawnWebServer, waitForWebUrl } from "./test-utils.js";

describe("CLI web workflows", () => {
	test("web server serves API and honors -C", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			["-C", root, "schema", "create", "clients", "--prefix", "cli", "--slug", "{{name}}-{{short_id}}"],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "clients", "name", "--type", "string", "--required"],
			root,
		);
		await runOk(["-C", root, "create", "cli", "Acme"], root);

		const proc = spawnWebServer(root);
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
			const docs = (await docsResp.json()) as { documents: Array<{ title: string }> };
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
			["-C", root, "schema", "create", "clients", "--prefix", "cli", "--slug", "{{name}}-{{short_id}}"],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "clients", "name", "--type", "string", "--required"],
			root,
		);
		await runOk(["-C", root, "create", "cli", "Acme"], root);

		const proc = spawnWebServer(root);
		try {
			const url = await waitForWebUrl(proc.stdout);
			const docsResp = await fetch(new URL("/api/documents?collection=cli", url));
			expect(docsResp.status).toBe(200);
			const docs = (await docsResp.json()) as { documents: Array<{ id: string }> };
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
			const uploaded = (await uploadResp.json()) as { path: string };
			expect(uploaded.path.endsWith("/notes.txt")).toBe(true);

			const readResp = await fetch(new URL(`/api/documents/${encodeURIComponent(id)}`, url));
			expect(readResp.status).toBe(200);
			const read = (await readResp.json()) as { document: { content: string; path: string } };
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
			["-C", root, "schema", "create", "clients", "--prefix", "cli", "--slug", "{{name}}-{{short_id}}"],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "clients", "name", "--type", "string", "--required"],
			root,
		);
		await runOk(["-C", root, "create", "cli", "Acme"], root);

		const proc = spawnWebServer(root);
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
			["-C", root, "schema", "create", "contacts", "--prefix", "con", "--slug", "{{name}}-{{short_id}}"],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "contacts", "name", "--type", "string", "--required"],
			root,
		);
		await runOk(["-C", root, "create", "con", "Alice Example"], root);

		const proc = spawnWebServer(root);
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
			expect(legacyResp.headers.get("location")).toBe(
				`/c/${encodeURIComponent(doc.collection)}/${encodeURIComponent(slug)}`,
			);
		} finally {
			proc.kill("SIGINT");
			await proc.exited;
		}
	});

	test("web create API uses open-style draft lifecycle and reopens existing slug target", async () => {
		const root = await mkdtemp(join(tmpdir(), "tmdoc-cli-web-open-defaults-"));
		await runOk(["-C", root, "init"], root);
		await runOk(
			["-C", root, "schema", "create", "clients", "--prefix", "cli", "--slug", "{{name}}-{{short_id}}"],
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

		const proc = spawnWebServer(root);
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
			const docsBeforeSave = (await docsBeforeSaveResp.json()) as { documents: Array<{ id: string }> };
			expect(docsBeforeSave.documents).toHaveLength(0);

			const saveResp = await fetch(new URL(`/api/documents/${encodeURIComponent(created.document.id)}`, url), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ fields: { name: "Untitled Client" }, content: "Created from draft.\n" }),
			});
			expect(saveResp.status).toBe(200);
			const saved = (await saveResp.json()) as { document: { id: string; path: string } };
			expect(saved.document.path.startsWith("clients/")).toBe(true);
			expect(saved.document.path.includes("/.tdo-")).toBe(false);

			const reopenResp = await fetch(new URL("/api/documents", url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collection: "clients", openDefaults: true }),
			});
			expect(reopenResp.status).toBe(200);
			const reopened = (await reopenResp.json()) as { document: { id: string } };
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
			["-C", root, "schema", "create", "contacts", "--prefix", "con", "--slug", "{{name}}-{{short_id}}"],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "contacts", "name", "--type", "string", "--required"],
			root,
		);

		const proc = spawnWebServer(root);
		try {
			const url = await waitForWebUrl(proc.stdout);
			const createResp = await fetch(new URL("/api/documents", url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ collection: "con", openDefaults: true }),
			});
			expect(createResp.status).toBe(201);
			const created = (await createResp.json()) as { document: { path: string; draft?: boolean } };
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
			["-C", root, "schema", "create", "clients", "--prefix", "cli", "--slug", "{{name}}-{{short_id}}"],
			root,
		);
		await runOk(
			["-C", root, "schema", "field", "create", "clients", "name", "--type", "string", "--required"],
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

		const proc = spawnWebServer(root, ["--collection", "cli", "--collection", "jrn"]);
		try {
			const url = await waitForWebUrl(proc.stdout);
			const collectionsResp = await fetch(new URL("/api/collections", url));
			expect(collectionsResp.status).toBe(200);
			const collections = (await collectionsResp.json()) as { collections: Array<{ name: string }> };
			expect(collections.collections.map((c) => c.name).sort()).toEqual(["clients", "journal"]);

			const disallowedResp = await fetch(new URL("/api/documents?collection=templates", url));
			expect(disallowedResp.status).toBe(200);
			const disallowed = (await disallowedResp.json()) as { documents: unknown[] };
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
