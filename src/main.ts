#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { stringify } from "yaml";
import { contentPath as documentContentPath } from "./document/document.js";
import { extractPlaceholders } from "./document/template-engine.js";
import { Manager } from "./manager.js";
import {
	byCollection,
	byField,
	type DocumentRecord,
	hasField,
	not,
} from "./repository/repository.js";
import { formatSchemaReadText, formatSchemaShowText } from "./services/schema-service.js";
import type { TemplateRecord } from "./services/template-service.js";
import { FileLock } from "./storage/lock.js";

type SchemaOutputFormat = "text" | "json" | "yaml";
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
				output: WriteOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const created = await withWriteLock(manager, async () => {
				const collection = opts.collection ?? argCollection;
				if (!collection) {
					throw new Error("collection is required");
				}

				const resolvedCollection = manager.Documents().ResolveCollection(collection);
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

				return await manager.Documents().Create({
					collection: resolvedCollection,
					fields,
					content: opts.content,
					templateContent,
				});
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
	.option("-o, --output <format>", "Output format: default|json|path", "default")
	.action(
		async (
			id: string,
			opts: { field: string[]; unset: string[]; content?: string; output: WriteOutputFormat },
		) => {
			if (opts.field.length === 0 && opts.unset.length === 0 && opts.content === undefined) {
				throw new Error("no fields or content to update");
			}
			const content = opts.content === "-" ? await readFromStdin() : opts.content;
			const manager = await Manager.New(getWorkDir(program));
			const updated = await withWriteLock(manager, async () => {
				return await manager.Documents().UpdateByID(id, {
					fields: parseFields(opts.field),
					unsetFields: opts.unset,
					content,
				});
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

			if (collection) {
				filters.push(byCollection(manager.Documents().ResolveCollection(collection)));
			}
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

			let docs = await manager.Documents().List(filters);
			if (query) {
				docs = docs.filter((doc) => manager.Search().MatchesQuery(doc, query));
			}
			if (opts.limit !== undefined) {
				docs = docs.slice(0, Math.max(0, opts.limit));
			}
			if (opts.output === "json") {
				console.log(JSON.stringify(docs, null, 2));
				return;
			}
			if (opts.output === "csv") {
				console.log(listResultsToCsv(docs));
				return;
			}

			for (const doc of docs) {
				console.log(doc.path);
			}
		},
	);

program
	.command("open")
	.alias("edit")
	.description("Open a document in $EDITOR")
	.argument("<collection>", "Collection name or alias")
	.argument("[idOrArg]", "Document id or slug value")
	.action(async (collection: string, idOrArg: string | undefined) => {
		const manager = await Manager.New(getWorkDir(program));
		const resolvedCollection = manager.Documents().ResolveCollection(collection);

		const record: DocumentRecord = await withWriteLock(manager, async () => {
			if (idOrArg) {
				try {
					return await manager.Documents().ReadByID(`${resolvedCollection}/${idOrArg}`);
				} catch {
					const upsert = await manager.Documents().UpsertBySlug(resolvedCollection, [idOrArg]);
					return upsert.record;
				}
			}

			const schema = manager.Schemas().get(resolvedCollection);
			if (!schema) {
				throw new Error(`unknown collection: ${collection}`);
			}
			const vars = extractPlaceholders(schema.slug).filter((v) => v !== "short_id" && v !== "date");
			const defaults = vars.map((name) => {
				const value = schema.fields[name]?.default;
				if (value === undefined || value === null || String(value).length === 0) {
					throw new Error(`missing argument for template variable '{{${name}}}'`);
				}
				return String(value);
			});
			const upsert = await manager.Documents().UpsertBySlug(resolvedCollection, defaults);
			return upsert.record;
		});

		const absPath = join(manager.RootPath(), documentContentPath(record.document));
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
			}

			const check = await manager.Validation().Check({
				collection: resolvedCollection,
				fix: false,
				pruneAttachments: false,
			});
			const issues = check.issues.filter(
				(issue) =>
					issue.path === record.path &&
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
			return await manager.Documents().AutoRenamePath(record.path);
		});
		console.log(renamedPath);
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
	.option("-o, --output <format>", "Output format: text|json", "text")
	.action(
		async (
			collection: string | undefined,
			opts: { fix: boolean; pruneAttachments: boolean; output: CheckOutputFormat },
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
			for (const issue of result.issues) {
				console.log(`${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`);
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

const schema = program.command("schema").description("Manage the schema");

schema
	.command("show")
	.description("Show all schemas and aliases")
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(async (opts: { output: SchemaOutputFormat }) => {
		const manager = await Manager.New(getWorkDir(program));
		const result = manager.Schema().show();
		renderSchemaOutput(result, opts.output, formatSchemaShowText);
	});

schema
	.command("read")
	.description("Read one collection schema")
	.argument("<collection>", "Collection name or alias")
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(async (collection: string, opts: { output: SchemaOutputFormat }) => {
		const manager = await Manager.New(getWorkDir(program));
		const result = manager.Schema().read(collection);
		renderSchemaOutput(result, opts.output, formatSchemaReadText);
	});

schema
	.command("create")
	.description("Create a collection schema")
	.argument("<collection>", "Collection name")
	.option("--prefix <alias>", "Alias prefix")
	.option("--slug <template>", "Slug template")
	.option("--short-id-length <n>", "Short ID length", parseIntArg)
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(
		async (
			collection: string,
			opts: {
				prefix?: string;
				slug?: string;
				shortIdLength?: number;
				output: SchemaOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const result = await withWriteLock(manager, async () => {
				return await manager.Schema().AddCollection({
					name: collection,
					alias: opts.prefix,
					slug: opts.slug,
					shortIdLength: opts.shortIdLength,
				});
			});
			renderSchemaOutput(result, opts.output, formatSchemaReadText);
		},
	);

schema
	.command("update")
	.description("Update a collection schema")
	.argument("<collection>", "Collection name or alias")
	.option("--prefix <alias>", "Alias prefix")
	.option("--slug <template>", "Slug template")
	.option("--short-id-length <n>", "Short ID length", parseIntArg)
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(
		async (
			collection: string,
			opts: {
				prefix?: string;
				slug?: string;
				shortIdLength?: number;
				output: SchemaOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const result = await withWriteLock(manager, async () => {
				return await manager.Schema().UpdateCollection({
					name: collection,
					alias: opts.prefix,
					slug: opts.slug,
					shortIdLength: opts.shortIdLength,
				});
			});
			renderSchemaOutput(result, opts.output, formatSchemaReadText);
		},
	);

schema
	.command("rename")
	.description("Rename a collection")
	.argument("<oldName>", "Current collection name or alias")
	.argument("<newName>", "New collection name")
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(async (oldName: string, newName: string, opts: { output: SchemaOutputFormat }) => {
		const manager = await Manager.New(getWorkDir(program));
		const result = await withWriteLock(manager, async () => {
			return await manager.Schema().RenameCollection(oldName, newName);
		});
		renderSchemaOutput(result, opts.output, formatSchemaReadText);
	});

schema
	.command("delete")
	.description("Delete a collection")
	.argument("<collection>", "Collection name or alias")
	.option("--remove-documents", "Remove documents in collection", false)
	.option("--force", "Skip non-empty checks", false)
	.action(
		async (
			collection: string,
			opts: {
				removeDocuments: boolean;
				force: boolean;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			await withWriteLock(manager, async () => {
				await manager.Schema().RemoveCollection({
					name: collection,
					removeDocuments: opts.removeDocuments,
					force: opts.force,
				});
			});
			console.log(`Deleted collection ${collection}`);
		},
	);

const schemaField = schema.command("field").description("Manage collection fields");

schemaField
	.command("create")
	.description("Create a field in collection schema")
	.argument("<collection>", "Collection name or alias")
	.argument("<field>", "Field name")
	.option("--type <type>", "Field type", "string")
	.option("--required", "Mark field as required", false)
	.option("--default <value>", "Default value")
	.option("--enum-values <v1,v2,...>", "Comma-separated enum values")
	.option("--min <n>", "Minimum number", parseFloatArg)
	.option("--max <n>", "Maximum number", parseFloatArg)
	.option("--weight <n>", "Weight for interactive ordering", parseIntArg)
	.option("--target <collection>", "Reference target collection")
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(
		async (
			collection: string,
			field: string,
			opts: {
				type: string;
				required: boolean;
				default?: string;
				enumValues?: string;
				min?: number;
				max?: number;
				weight?: number;
				target?: string;
				output: SchemaOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const fieldDef: Record<string, unknown> = {
				type: opts.type,
			};
			if (opts.required) fieldDef.required = true;
			if (opts.default !== undefined) fieldDef.default = opts.default;
			if (opts.enumValues) fieldDef.enum_values = splitCSV(opts.enumValues);
			if (opts.min !== undefined) fieldDef.min = opts.min;
			if (opts.max !== undefined) fieldDef.max = opts.max;
			if (opts.weight !== undefined) fieldDef.weight = opts.weight;
			const result = await withWriteLock(manager, async () => {
				return await manager
					.Schema()
					.AddFieldToCollection(collection, field, fieldDef as never, opts.target);
			});
			renderSchemaOutput(result, opts.output, formatSchemaReadText);
		},
	);

schemaField
	.command("update")
	.description("Update a field in collection schema")
	.argument("<collection>", "Collection name or alias")
	.argument("<field>", "Field name")
	.option("--type <type>", "Field type")
	.option("--required <bool>", "Required true|false")
	.option("--default <value>", "Default value")
	.option("--enum-values <v1,v2,...>", "Comma-separated enum values")
	.option("--min <n>", "Minimum number", parseFloatArg)
	.option("--max <n>", "Maximum number", parseFloatArg)
	.option("--weight <n>", "Weight for interactive ordering", parseIntArg)
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(
		async (
			collection: string,
			field: string,
			opts: {
				type?: string;
				required?: string;
				default?: string;
				enumValues?: string;
				min?: number;
				max?: number;
				weight?: number;
				output: SchemaOutputFormat;
			},
		) => {
			const manager = await Manager.New(getWorkDir(program));
			const update: Record<string, unknown> = {};
			if (opts.type !== undefined) update.type = opts.type;
			if (opts.required !== undefined) update.required = parseBool(opts.required);
			if (opts.default !== undefined) update.default = opts.default;
			if (opts.enumValues !== undefined) update.enum_values = splitCSV(opts.enumValues);
			if (opts.min !== undefined) update.min = opts.min;
			if (opts.max !== undefined) update.max = opts.max;
			if (opts.weight !== undefined) update.weight = opts.weight;
			const result = await withWriteLock(manager, async () => {
				return await manager.Schema().UpdateFieldInCollection(collection, field, update as never);
			});
			renderSchemaOutput(result, opts.output, formatSchemaReadText);
		},
	);

schemaField
	.command("delete")
	.description("Delete a field in collection schema")
	.argument("<collection>", "Collection name or alias")
	.argument("<field>", "Field name")
	.option("-o, --output <format>", "Output format: text|json|yaml", "text")
	.action(async (collection: string, field: string, opts: { output: SchemaOutputFormat }) => {
		const manager = await Manager.New(getWorkDir(program));
		const result = await withWriteLock(manager, async () => {
			return await manager.Schema().RemoveFieldFromCollection(collection, field);
		});
		renderSchemaOutput(result, opts.output, formatSchemaReadText);
	});

await program.parseAsync(process.argv);

function getWorkDir(cmd: Command): string {
	const directory = cmd.opts<{ directory?: string }>().directory;
	return resolve(directory ?? process.cwd());
}

function renderSchemaOutput<T>(
	result: T,
	format: string,
	textFormatter: (value: T) => string,
): void {
	switch (format) {
		case "text":
			console.log(textFormatter(result));
			return;
		case "json":
			console.log(JSON.stringify(result, null, 2));
			return;
		case "yaml":
			console.log(stringify(result, { lineWidth: 0 }).trimEnd());
			return;
		default:
			throw new Error(`unsupported output format: ${format}`);
	}
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
			console.log(`Created ${record.path} (${String(record.document.metadata.id ?? "")})`);
	}
}

function collectRepeated(value: string, previous: string[]): string[] {
	return [...previous, value];
}

function parseFields(values: string[]): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const entry of values) {
		const [key, value] = splitFieldArg(entry);
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

function parseFloatArg(value: string): number {
	const parsed = Number.parseFloat(value);
	if (Number.isNaN(parsed)) {
		throw new Error(`invalid number: ${value}`);
	}
	return parsed;
}

function parseBool(value: string): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`invalid boolean: ${value} (expected true|false)`);
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

function splitCSV(value: string): string[] {
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}

async function withWriteLock<T>(manager: Manager, fn: () => Promise<T>): Promise<T> {
	const lock = new FileLock(manager.RootPath());
	await lock.acquire();
	try {
		return await fn();
	} finally {
		await lock.release();
	}
}

function searchResultsToCsv(
	results: Array<{ document: { path: string }; tier: number; score: number; matchCount: number }>,
): string {
	const lines = ["path,tier,score,match_count"];
	for (const row of results) {
		lines.push(`${csv(row.document.path)},${row.tier},${row.score},${row.matchCount}`);
	}
	return lines.join("\n");
}

function listResultsToCsv(
	results: Array<{ path: string; document: { metadata: Record<string, unknown> } }>,
): string {
	const lines = ["path,collection,id,name"];
	for (const row of results) {
		const collection = row.path.split("/")[0] ?? "";
		const id = String(row.document.metadata.id ?? "");
		const name = String(row.document.metadata.name ?? row.document.metadata.title ?? "");
		lines.push(`${csv(row.path)},${csv(collection)},${csv(id)},${csv(name)}`);
	}
	return lines.join("\n");
}

function csv(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
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
