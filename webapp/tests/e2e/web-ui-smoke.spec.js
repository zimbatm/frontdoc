import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

async function waitForWebUrl(proc) {
	let buffer = "";
	const deadline = Date.now() + 10000;
	for await (const chunk of proc.stdout) {
		buffer += chunk.toString();
		const match = buffer.match(/http:\/\/[^\s]+/);
		if (match) {
			return match[0];
		}
		if (Date.now() > deadline) {
			break;
		}
	}
	throw new Error(`timed out waiting for web url; output=${buffer}`);
}

test("web ui renders and lists documents", async ({ page }) => {
	const root = mkdtempSync(join(tmpdir(), "frontdoc-web-e2e-"));
	execFileSync("bun", ["run", "src/main.ts", "-C", root, "init"], { stdio: "pipe" });
	execFileSync(
		"bun",
		[
			"run",
			"src/main.ts",
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
		{ stdio: "pipe" },
	);
	execFileSync(
		"bun",
		[
			"run",
			"src/main.ts",
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
		{ stdio: "pipe" },
	);
	execFileSync("bun", ["run", "src/main.ts", "-C", root, "create", "cli", "Acme"], {
		stdio: "pipe",
	});

	const proc = spawn(
		"bun",
		["run", "src/main.ts", "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);

	try {
		const url = await waitForWebUrl(proc);
		await page.goto(url);
		await expect(page.locator("[data-testid='nav-pane']")).toBeVisible();
		await expect(page.locator("[data-testid='doc-list']")).toContainText("Acme");
	} finally {
		proc.kill("SIGINT");
	}
});
