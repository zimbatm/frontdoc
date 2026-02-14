import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { defaultSlugArgsForSchema } from "../app/document-use-cases.js";
import { withWriteLock } from "../app/write-lock.js";
import { buildDocument, contentPath as documentContentPath } from "../document/document.js";
import { collectionFromPath } from "../document/path-utils.js";
import { type DocumentRecord } from "../repository/repository.js";
import type { TemplateRecord } from "../services/template-service.js";
import { Manager } from "../manager.js";

export function registerOpenCommand(
	program: Command,
	getWorkDir: (cmd: Command) => string,
	chooseTemplateContent: (templates: TemplateRecord[], collection: string) => Promise<string>,
): void {
	program
		.command("open")
		.alias("edit")
		.description("Open a document in $EDITOR")
		.argument("<collection>", "Collection name or alias")
		.argument("[idOrArg]", "Document id or slug value")
		.action(async (collection: string, idOrArg: string | undefined) => {
			const manager = await Manager.New(getWorkDir(program));
			const resolvedCollection = manager.Documents().ResolveCollection(collection);
			let templateResolved = false;
			let templateContent: string | undefined;
			const resolveTemplateContent = async (): Promise<string | undefined> => {
				if (templateResolved) {
					return templateContent;
				}
				const templates = await manager.Templates().GetTemplatesForCollection(resolvedCollection);
				if (templates.length === 1) {
					templateContent = templates[0].content;
				} else if (templates.length > 1) {
					templateContent = await chooseTemplateContent(templates, resolvedCollection);
				}
				templateResolved = true;
				return templateContent;
			};

			const existing: DocumentRecord | null = await withWriteLock(manager, async () => {
				if (idOrArg) {
					try {
						return await manager.Documents().ReadByID(`${resolvedCollection}/${idOrArg}`);
					} catch {
						const planned = await manager.Documents().PlanBySlug(resolvedCollection, [idOrArg], {
							resolveTemplateContent,
						});
						return planned.record;
					}
				}

				const schema = manager.Schemas().get(resolvedCollection);
				if (!schema) {
					throw new Error(`unknown collection: ${collection}`);
				}
				const defaults = defaultSlugArgsForSchema(schema);
				const planned = await manager.Documents().PlanBySlug(resolvedCollection, defaults, {
					resolveTemplateContent,
				});
				return planned.record;
			});

			if (existing) {
				const absPath = join(manager.RootPath(), documentContentPath(existing.document));
				const editor = process.env.EDITOR || "vi";
				let reopen = true;
				while (reopen) {
					if (process.env.TMDOC_SKIP_EDITOR !== "1") {
						const result = spawnSync(editor, [absPath], { stdio: "inherit" });
						if (result.error) {
							throw result.error;
						}
						if (result.status !== 0) {
							throw new Error(`editor exited with status ${result.status}`);
						}
						manager.Repository().invalidateCache();
					}

					const check = await manager.Validation().Check({
						collection: resolvedCollection,
						fix: false,
						pruneAttachments: false,
					});
					const issues = check.issues.filter(
						(issue) =>
							issue.path === existing.path &&
							issue.code !== "filename.mismatch" &&
							issue.code !== "filename.invalid",
					);
					if (issues.length === 0) {
						break;
					}
					console.log("Validation issues found:");
					for (const issue of issues) {
						console.log(`${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`);
					}

					if (process.env.TMDOC_SKIP_EDITOR === "1") {
						break;
					}
					reopen = await confirmReopen();
				}

				const renamedPath = await withWriteLock(manager, async () => {
					return await manager.Documents().AutoRenamePath(existing.path);
				});
				console.log(renamedPath);
				return;
			}

			const planned = await withWriteLock(manager, async () => {
				if (idOrArg) {
					return await manager.Documents().PlanBySlug(resolvedCollection, [idOrArg], {
						resolveTemplateContent,
					});
				}
				const schema = manager.Schemas().get(resolvedCollection);
				if (!schema) {
					throw new Error(`unknown collection: ${collection}`);
				}
				const defaults = defaultSlugArgsForSchema(schema);
				return await manager.Documents().PlanBySlug(resolvedCollection, defaults, {
					resolveTemplateContent,
				});
			});
			if (planned.record || !planned.draft) {
				throw new Error("expected draft plan for missing open target");
			}
			const targetPath = planned.draft.path;
			const draftPath = openDraftPath(targetPath, String(planned.draft.metadata._id ?? ""));
			const baselineRaw = buildDocument(planned.draft);
			await withWriteLock(manager, async () => {
				await manager.Drafts().Write(draftPath, baselineRaw);
			});

			const absPath = join(manager.RootPath(), draftPath);
			const editor = process.env.EDITOR || "vi";
			while (true) {
				if (process.env.TMDOC_SKIP_EDITOR !== "1") {
					const result = spawnSync(editor, [absPath], { stdio: "inherit" });
					if (result.error) {
						throw result.error;
					}
					if (result.status !== 0) {
						throw new Error(`editor exited with status ${result.status}`);
					}
					manager.Repository().invalidateCache();
				}
				const raw = await manager.Drafts().Read(draftPath);
				if (raw === baselineRaw) {
					await withWriteLock(manager, async () => {
						await manager.Drafts().RemoveIfExists(draftPath);
					});
					return;
				}

				const issues = (
					await manager.Validation().ValidateRaw(resolvedCollection, targetPath, raw)
				).filter((issue) => issue.code !== "filename.mismatch" && issue.code !== "filename.invalid");
				if (issues.length === 0) {
					const renamedPath = await withWriteLock(manager, async () => {
						await manager.Drafts().Write(targetPath, raw);
						await manager.Drafts().RemoveIfExists(draftPath);
						return await manager.Documents().AutoRenamePath(targetPath);
					});
					console.log(renamedPath);
					return;
				}
				console.log("Validation issues found:");
				for (const issue of issues) {
					console.log(`${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`);
				}

				if (process.env.TMDOC_SKIP_EDITOR === "1") {
					console.log(draftPath);
					return;
				}
				const action = await chooseDraftValidationAction();
				if (action === "reopen") {
					continue;
				}
				if (action === "keep") {
					console.log(draftPath);
					return;
				}
				await withWriteLock(manager, async () => {
					await manager.Drafts().RemoveIfExists(draftPath);
				});
				return;
			}
		});
}

async function confirmReopen(): Promise<boolean> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = await rl.question("Re-open editor to fix issues? [y/N] ");
		const normalized = answer.trim().toLowerCase();
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

type DraftValidationAction = "reopen" | "keep" | "discard";

async function chooseDraftValidationAction(): Promise<DraftValidationAction> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		console.log("1. Re-open draft to fix issues");
		console.log("2. Keep draft and exit");
		console.log("3. Discard draft");
		const answer = await rl.question("Choose action [1/2/3]: ");
		const normalized = answer.trim();
		if (normalized === "1") return "reopen";
		if (normalized === "2") return "keep";
		if (normalized === "3") return "discard";
		throw new Error(`invalid selection: ${answer.trim()}`);
	} finally {
		rl.close();
	}
}

function openDraftPath(targetPath: string, id: string): string {
	const collection = collectionFromPath(targetPath);
	const base = basename(targetPath, ".md")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const suffix = base.length > 0 ? base : "draft";
	const shortID = id.length >= 6 ? id.slice(-6) : "draft";
	return `${collection}/.tdo-${shortID}-${suffix}.md`;
}
