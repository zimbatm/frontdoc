import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { createDocumentUseCase, updateDocumentUseCase } from "../app/document-use-cases.js";
import {
	listDocumentsUseCase,
	normalizeFieldsForSchema,
} from "../app/document-use-cases.js";
import { withWriteLock } from "../app/write-lock.js";
import { listResultsToCsv, listResultsToTable, searchResultsToCsv } from "./output-format.js";
import { registerOpenCommand } from "./open-command.js";
import { registerSchemaCommands } from "./schema-commands.js";
import { collectionFromPath } from "../document/path-utils.js";
import { extractPlaceholders } from "../document/template-engine.js";
import { Manager } from "../manager.js";
import {
	byField,
	hasField,
	not,
} from "../repository/repository.js";
import type { TemplateRecord } from "../services/template-service.js";
import { runWebServer } from "../web/server.js";

type ReadOutputFormat = "markdown" | "json" | "raw";
type ListOutputFormat = "table" | "json" | "csv";
type WriteOutputFormat = "default" | "json" | "path";
type CheckOutputFormat = "text" | "json";
type SearchOutputFormat = "detail" | "table" | "json" | "csv";

const program = new Command();

program
	.name("tmdoc")
	.description("CLI tool for managing Markdown document collections")
	.option("-C, --directory <path>", "Run as if started in this path");

program
	.command("init")
	.description("Initialize a tmdoc repository")
	.action(async () => {
		const workDir = getWorkDir(program);
		try {
			await Manager.Init(workDir);
			console.log("Initialized tmdoc repository");
		} catch (err) {
			if (err instanceof Error && err.message.includes("already initialized")) {
				console.log("already initialized");
				return;
			}
			throw err;
		}
	});

program
	.command("create")
	.alias("new")
	.description("Create a new document")
	.argument("[collection]", "Collection name")
	.argument("[title]", "Optional title mapped to first slug field")
	.option("-c, --collection <name>", "Collection name")
	.option("-f, --field <key=value>", "Field value", collectRepeated, [])
	.option("--template <name>", "Template name")
	.option("--no-template", "Skip template selection and processing")
	.option("--content <text>", "Initial content")
	.option("--skip-validation", "Bypass validation", false)
	.option("-o, --output <format>", "Output format: default|json|path", "default")
	.action(
		async (
			argCollection: string | undefined,
			title: string | undefined,
			opts: {
				collection?: string;
				field: string[];
				template?: string | boolean;
				content?: string;
				skipValidation: boolean;
				output: WriteOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const created = await withWriteLock(manager, async () => {
				const collection = opts.collection ?? argCollection;
				const chosenCollection =
					collection && collection.length > 0
						? collection
						: await chooseCollection(Array.from(manager.Schemas().keys()));

				const resolvedCollection = manager.Documents().ResolveCollection(chosenCollection);
				const schema = manager.Schemas().get(resolvedCollection);
				if (!schema) {
					throw new Error(`unknown collection: ${collection}`);
				}

					const fields = parseFields(opts.field);
				if (title) {
					const titleField = firstSlugField(schema.slug);
					if (titleField) {
						fields[titleField] = title;
					}
				}
					const normalizedFields = normalizeFieldsForSchema(fields, schema);

				let templateContent: string | undefined;
				const noTemplate = opts.template === false;
				const templateName = typeof opts.template === "string" ? opts.template : undefined;
				if (!noTemplate) {
					const templates = await manager.Templates().GetTemplatesForCollection(resolvedCollection);
					if (templateName) {
						const found = templates.find((template) => template.name === templateName);
						if (!found) {
							throw new Error(
								`template not found for collection '${resolvedCollection}': ${templateName}`,
							);
						}
						templateContent = found.content;
					} else if (templates.length === 1) {
						templateContent = templates[0].content;
					} else if (templates.length > 1) {
						templateContent = await chooseTemplateContent(templates, resolvedCollection);
					}
				}

				const created = await createDocumentUseCase(manager, {
					collection: resolvedCollection,
					fields: normalizedFields,
					content: opts.content,
					templateContent,
					skipValidation: opts.skipValidation,
				});
				return created;
			});

			renderWriteOutput(created, opts.output);
		},
	);

program
	.command("read")
	.alias("get")
	.description("Read a document")
	.argument("<id>", "Document id")
	.option("-o, --output <format>", "Output format: markdown|json|raw", "markdown")
	.action(async (id: string, opts: { output: ReadOutputFormat }) => {
		const manager = await Manager.New(getWorkDir(program));
		if (opts.output === "raw") {
			console.log(await manager.Documents().ReadRawByID(id));
			return;
		}

		const record = await manager.Documents().ReadByID(id);
		if (opts.output === "json") {
			console.log(JSON.stringify(record, null, 2));
			return;
		}

		const raw = await manager.Documents().ReadRawByID(id);
		console.log(raw);
	});

program
	.command("update")
	.alias("modify")
	.description("Update fields/content of a document")
	.argument("<id>", "Document id")
	.option("-f, --field <key=value>", "Field value", collectRepeated, [])
	.option("--unset <key>", "Unset field", collectRepeated, [])
	.option("--content <text>", "Replace markdown content")
	.option("--skip-validation", "Bypass validation", false)
	.option("-o, --output <format>", "Output format: default|json|path", "default")
	.action(
		async (
			id: string,
			opts: {
				field: string[];
				unset: string[];
				content?: string;
				skipValidation: boolean;
				output: WriteOutputFormat;
			},
		) => {
			if (opts.field.length === 0 && opts.unset.length === 0 && opts.content === undefined) {
				throw new Error("no fields or content to update");
			}
			const content = opts.content === "-" ? await readFromStdin() : opts.content;
			const manager = await Manager.New(getWorkDir(program));
			const updated = await withWriteLock(manager, async () => {
				const existing = await manager.Documents().ReadByID(id);
				const collection = collectionFromPath(existing.path);
				const schema = manager.Schemas().get(collection);
				if (!schema) {
					throw new Error(`unknown collection: ${collection}`);
				}
					const fields = normalizeFieldsForSchema(parseFields(opts.field), schema);
				for (const key of opts.unset) {
					assertUserFieldInput(key);
				}
				const updated = await updateDocumentUseCase(manager, {
					id,
					fields,
					unsetFields: opts.unset,
					content,
					skipValidation: opts.skipValidation,
				});
				return updated;
			});
			renderWriteOutput(updated, opts.output);
		},
	);

program
	.command("delete")
	.alias("rm")
	.description("Delete a document")
	.argument("<id>", "Document id")
	.option("--force", "Skip confirmation prompt", false)
	.option("-o, --output <format>", "Output format: default|json", "default")
	.action(async (id: string, opts: { force: boolean; output: "default" | "json" }) => {
		const manager = await Manager.New(getWorkDir(program));
		if (!opts.force) {
			const confirmed = await confirmDelete(id);
			if (!confirmed) {
				console.log("Aborted");
				return;
			}
		}
		const record = await withWriteLock(manager, async () => {
			const existing = await manager.Documents().ReadByID(id);
			await manager.Documents().DeleteByID(id);
			return existing;
		});
		if (opts.output === "json") {
			console.log(JSON.stringify({ deleted: true, path: record.path }, null, 2));
			return;
		}
		console.log(`Deleted ${record.path}`);
	});

program
	.command("list")
	.alias("ls")
	.description("List documents")
	.argument("[collection]", "Collection name")
	.argument("[query]", "Optional query expression")
	.option("-f, --filter <key=value>", "Metadata equality filter", collectRepeated, [])
	.option("--has <key>", "Field existence filter", collectRepeated, [])
	.option("--lacks <key>", "Field absence filter", collectRepeated, [])
	.option("-n, --limit <n>", "Limit results", parseIntArg)
	.option("-o, --output <format>", "Output format: table|json|csv", "table")
	.action(
		async (
			collection: string | undefined,
			query: string | undefined,
			opts: {
				filter: string[];
				has: string[];
				lacks: string[];
				limit?: number;
				output: ListOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const filters = [];

				for (const entry of opts.filter) {
					const [key, value] = splitFieldArg(entry);
					filters.push(byField(key, value));
			}
			for (const key of opts.has) {
				filters.push(hasField(key));
			}
			for (const key of opts.lacks) {
				filters.push(not(hasField(key)));
			}

				const docs = await listDocumentsUseCase(manager, {
					collection,
					query,
					filters,
					limit: opts.limit,
				});
			if (opts.output === "json") {
				console.log(JSON.stringify(docs, null, 2));
				return;
			}
			if (opts.output === "csv") {
				console.log(listResultsToCsv(docs));
				return;
			}
			console.log(listResultsToTable(docs));
		},
	);

program
registerOpenCommand(program, getWorkDir, chooseTemplateContent);

program
	.command("web")
	.alias("serve")
	.description("Start a local Web UI server")
	.option("--host <host>", "Bind host", "127.0.0.1")
	.option("--port <port>", "Bind port (0 = auto)", parseIntArg, 0)
	.option("--open", "Auto-open browser on startup", true)
	.option("--no-open", "Disable browser auto-open")
	.option("--collection <name>", "Collection to serve (repeatable)", collectRepeated, [])
	.action(async (opts: { host: string; port: number; open: boolean; collection: string[] }) => {
		if (opts.port < 0 || opts.port > 65535) {
			throw new Error(`invalid port: ${opts.port}`);
		}
		const manager = await Manager.New(getWorkDir(program));
		await runWebServer(manager, {
			host: opts.host,
			port: opts.port,
			open: opts.open,
			collections: opts.collection,
		});
	});

program
	.command("attach")
	.description("Attach a file to a document")
	.argument("<id>", "Document id")
	.argument("<filePath>", "Path to source file on host filesystem")
	.option("--force", "Overwrite existing attachment", false)
	.option("--no-reference", "Do not append markdown reference")
	.option("-o, --output <format>", "Output format: default|json|path", "default")
	.action(
		async (
			id: string,
			filePath: string,
			opts: {
				force: boolean;
				reference: boolean;
				output: WriteOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const attachmentPath = await withWriteLock(manager, async () => {
				return await manager.Documents().AttachFileByID(id, filePath, opts.reference, opts.force);
			});
			const record = await manager.Documents().ReadByID(id);
			if (opts.output === "json") {
				console.log(JSON.stringify({ path: attachmentPath, document: record.path, id }, null, 2));
				return;
			}
			if (opts.output === "path") {
				console.log(attachmentPath);
				return;
			}
			console.log(`Attached ${attachmentPath}`);
		},
	);

program
	.command("check")
	.description("Validate documents")
	.argument("[collection]", "Optional collection scope")
	.option("--fix", "Auto-fix fixable issues", false)
	.option("--prune-attachments", "Remove unreferenced attachments (implies --fix)", false)
	.option("--verbose", "Show detailed issue output", false)
	.option("-o, --output <format>", "Output format: text|json", "text")
	.action(
		async (
			collection: string | undefined,
			opts: {
				fix: boolean;
				pruneAttachments: boolean;
				verbose: boolean;
				output: CheckOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const mutate = opts.fix || opts.pruneAttachments;
			const result = mutate
				? await withWriteLock(manager, async () => {
						return await manager.Validation().Check({
							collection,
							fix: true,
							pruneAttachments: opts.pruneAttachments,
						});
					})
				: await manager.Validation().Check({
						collection,
						fix: false,
						pruneAttachments: false,
					});
			if (opts.output === "json") {
				console.log(JSON.stringify(result, null, 2));
				return;
			}

			console.log(`Scanned: ${result.scanned}`);
			console.log(`Issues: ${result.issues.length}`);
			if (opts.fix || opts.pruneAttachments) {
				console.log(`Fixed: ${result.fixed}`);
			}
			if (opts.verbose) {
				for (const issue of result.issues) {
					console.log(`${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`);
				}
			}
		},
	);

program
	.command("search")
	.alias("find")
	.description("Search documents")
	.argument("<query>", "Search query")
	.option("-n, --limit <n>", "Limit results", parseIntArg)
	.option("-o, --output <format>", "Output format: detail|table|json|csv", "detail")
	.action(async (query: string, opts: { output: SearchOutputFormat; limit?: number }) => {
		const manager = await Manager.New(getWorkDir(program));
		let results = await manager.Search().UnifiedSearch(query);
		if (opts.limit !== undefined) {
			results = results.slice(0, Math.max(0, opts.limit));
		}
		switch (opts.output) {
			case "json":
				console.log(JSON.stringify(results, null, 2));
				return;
			case "csv":
				console.log(searchResultsToCsv(results));
				return;
			case "table":
				for (const row of results) {
					console.log(`${row.document.path}\t${row.tier}\t${row.matchCount}`);
				}
				return;
			default:
				for (const row of results) {
					console.log(`${row.document.path} (tier=${row.tier}, score=${row.score.toFixed(3)})`);
					for (const match of row.matches.slice(0, 3)) {
						console.log(`  - ${match.field}: ${match.context}`);
					}
				}
		}
	});

program
	.command("relationships")
	.description("Show document relationships")
	.argument("<id>", "Document id")
	.option("-o, --output <format>", "Output format: text|json", "text")
	.action(async (id: string, opts: { output: "text" | "json" }) => {
		const manager = await Manager.New(getWorkDir(program));
		const rel = await manager.Relationships().GetRelationships(id);
		if (opts.output === "json") {
			console.log(JSON.stringify(rel, null, 2));
			return;
		}
		console.log(`Target: ${rel.target.path}`);
		console.log("Outgoing:");
		for (const edge of rel.outgoing) {
			console.log(
				`  ${edge.type}: ${edge.from} -> ${edge.to}${edge.field ? ` (${edge.field})` : ""}`,
			);
		}
		console.log("Incoming:");
		for (const edge of rel.incoming) {
			console.log(
				`  ${edge.type}: ${edge.from} -> ${edge.to}${edge.field ? ` (${edge.field})` : ""}`,
			);
		}
	});

program
	.command("graph")
	.description("Generate relationship graph")
	.argument("[scope]", "Optional collection or document id scope")
	.option("-o, --output <format>", "Output format: dot|mermaid|json", "dot")
	.option("--file <path>", "Write output to file")
	.action(
		async (
			scope: string | undefined,
			opts: { output: "dot" | "mermaid" | "json"; file?: string },
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const edges = await manager.Relationships().BuildGraph(scope);
			const rendered =
				opts.output === "json"
					? JSON.stringify(edges, null, 2)
					: opts.output === "mermaid"
						? manager.Relationships().ToMermaid(edges)
						: manager.Relationships().ToDot(edges);

			if (opts.file) {
				await writeFile(opts.file, rendered, "utf8");
				console.log(opts.file);
				return;
			}
			console.log(rendered);
		},
	);

program
	.command("stats")
	.description("Show repository statistics")
	.option("-o, --output <format>", "Output format: text|json", "text")
	.action(async (opts: { output: "text" | "json" }) => {
		const manager = await Manager.New(getWorkDir(program));
		const stats = await manager.Relationships().Stats();
		if (opts.output === "json") {
			console.log(JSON.stringify(stats, null, 2));
			return;
		}
		console.log(`Total: ${stats.total}`);
		for (const [collection, count] of Object.entries(stats.byCollection).sort(([a], [b]) =>
			a.localeCompare(b),
		)) {
			console.log(`${collection}: ${count}`);
		}
	});

program
	.command("completion")
	.description("Generate shell completion scripts")
	.argument("<shell>", "bash|zsh|fish|powershell")
	.action((shell: "bash" | "zsh" | "fish" | "powershell") => {
		console.log(completionScript(shell));
	});

registerSchemaCommands(program);

export async function runCli(argv: string[] = process.argv): Promise<void> {
	try {
		await program.parseAsync(argv);
	} catch (err) {
		if (err instanceof Error) {
			if (process.env.TMDOC_DEBUG === "1" && err.stack) {
				console.error(err.stack);
			} else {
				console.error(`Error: ${err.message}`);
			}
			process.exit(1);
		}
		console.error("Error: unknown failure");
		process.exit(1);
	}
}

function getWorkDir(cmd: Command): string {
	const directory = cmd.opts<{ directory?: string }>().directory;
	return resolve(directory ?? process.cwd());
}

function renderWriteOutput(
	record: { path: string; document: { metadata: Record<string, unknown> } },
	format: WriteOutputFormat,
): void {
	switch (format) {
		case "json":
			console.log(JSON.stringify(record, null, 2));
			return;
		case "path":
			console.log(record.path);
			return;
		default:
			console.log(`Created ${record.path} (${String(record.document.metadata._id ?? "")})`);
	}
}

function collectRepeated(value: string, previous: string[]): string[] {
	return [...previous, value];
}

function parseFields(values: string[]): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const entry of values) {
		const [key, value] = splitFieldArg(entry);
		assertUserFieldInput(key);
		fields[key] = value;
	}
	return fields;
}

function splitFieldArg(entry: string): [string, string] {
	const idx = entry.indexOf("=");
	if (idx === -1) {
		throw new Error(`invalid field argument: '${entry}', expected key=value`);
	}
	const key = entry.slice(0, idx).trim();
	const value = entry.slice(idx + 1);
	if (key.length === 0) {
		throw new Error(`invalid field argument: '${entry}', empty key`);
	}
	return [key, value];
}

function assertUserFieldInput(field: string): void {
	if (field.startsWith("_")) {
		throw new Error(`reserved field prefix '_': ${field}`);
	}
}

function firstSlugField(slugTemplate: string): string | null {
	for (const name of extractPlaceholders(slugTemplate)) {
		if (name !== "short_id" && name !== "date") {
			return name;
		}
	}
	return null;
}

function parseIntArg(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		throw new Error(`invalid integer: ${value}`);
	}
	return parsed;
}

async function readFromStdin(): Promise<string> {
	const reader = process.stdin;
	reader.setEncoding("utf8");
	let content = "";
	for await (const chunk of reader) {
		content += chunk;
	}
	return content;
}

async function confirmDelete(id: string): Promise<boolean> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = await rl.question(`Delete ${id}? [y/N] `);
		const normalized = answer.trim().toLowerCase();
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

async function chooseTemplateContent(
	templates: TemplateRecord[],
	collection: string,
): Promise<string> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		console.log(`Multiple templates found for '${collection}':`);
		for (const [index, template] of templates.entries()) {
			console.log(`${index + 1}. ${template.name}`);
		}
		const answer = await rl.question("Select template number: ");
		const selection = Number.parseInt(answer.trim(), 10);
		if (Number.isNaN(selection) || selection < 1 || selection > templates.length) {
			throw new Error(`invalid template selection: ${answer.trim()}`);
		}
		return templates[selection - 1].content;
	} finally {
		rl.close();
	}
}

async function chooseCollection(collections: string[]): Promise<string> {
	if (collections.length === 0) {
		throw new Error("no collections available");
	}
	const sorted = [...collections].sort((a, b) => a.localeCompare(b));
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		console.log("Select collection:");
		for (const [index, collection] of sorted.entries()) {
			console.log(`${index + 1}. ${collection}`);
		}
		const answer = await rl.question("Collection number: ");
		const selection = Number.parseInt(answer.trim(), 10);
		if (Number.isNaN(selection) || selection < 1 || selection > sorted.length) {
			throw new Error(`invalid collection selection: ${answer.trim()}`);
		}
		return sorted[selection - 1];
	} finally {
		rl.close();
	}
}

function completionScript(shell: string): string {
	const commands =
		"init create read update delete list search open attach check schema relationships graph stats completion";
	switch (shell) {
		case "bash":
			return (
				"# bash completion for tmdoc\n" +
				"_tmdoc_complete() {\n" +
				'  local cur="${' +
				'COMP_WORDS[COMP_CWORD]}"\n' +
				`  COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )\n` +
				"}\n" +
				"complete -F _tmdoc_complete tmdoc"
			);
		case "zsh":
			return `#compdef tmdoc\n_arguments "1: :(${commands})"`;
		case "fish":
			return commands
				.split(" ")
				.map((cmd) => `complete -c tmdoc -f -a "${cmd}"`)
				.join("\n");
		case "powershell":
			return `Register-ArgumentCompleter -CommandName tmdoc -ScriptBlock {\n  param($wordToComplete)\n  '${commands}'.Split(' ') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {\n    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)\n  }\n}`;
		default:
			throw new Error(`unsupported shell: ${shell}`);
	}
}
