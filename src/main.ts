#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
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

type SchemaOutputFormat = "text" | "json" | "yaml";
type ReadOutputFormat = "markdown" | "json" | "raw";
type ListOutputFormat = "table" | "json";
type WriteOutputFormat = "default" | "json" | "path";

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
	.option("--content <text>", "Initial content")
	.option("-o, --output <format>", "Output format: default|json|path", "default")
	.action(
		async (
			argCollection: string | undefined,
			title: string | undefined,
			opts: { collection?: string; field: string[]; content?: string; output: WriteOutputFormat },
		) => {
			const manager = await Manager.New(getWorkDir(program));
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

			const created = await manager.Documents().Create({
				collection: resolvedCollection,
				fields,
				content: opts.content,
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
			const manager = await Manager.New(getWorkDir(program));
			const updated = await manager.Documents().UpdateByID(id, {
				fields: parseFields(opts.field),
				unsetFields: opts.unset,
				content: opts.content,
			});
			renderWriteOutput(updated, opts.output);
		},
	);

program
	.command("delete")
	.alias("rm")
	.description("Delete a document")
	.argument("<id>", "Document id")
	.option("-o, --output <format>", "Output format: default|json", "default")
	.action(async (id: string, opts: { output: "default" | "json" }) => {
		const manager = await Manager.New(getWorkDir(program));
		const record = await manager.Documents().ReadByID(id);
		await manager.Documents().DeleteByID(id);
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
	.option("-f, --filter <key=value>", "Metadata equality filter", collectRepeated, [])
	.option("--has <key>", "Field existence filter", collectRepeated, [])
	.option("--lacks <key>", "Field absence filter", collectRepeated, [])
	.option("-o, --output <format>", "Output format: table|json", "table")
	.action(
		async (
			collection: string | undefined,
			opts: { filter: string[]; has: string[]; lacks: string[]; output: ListOutputFormat },
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

			const docs = await manager.Documents().List(filters);
			if (opts.output === "json") {
				console.log(JSON.stringify(docs, null, 2));
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

		let record: DocumentRecord;
		if (idOrArg) {
			try {
				record = await manager.Documents().ReadByID(`${resolvedCollection}/${idOrArg}`);
			} catch {
				const upsert = await manager.Documents().UpsertBySlug(resolvedCollection, [idOrArg]);
				record = upsert.record;
			}
		} else {
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
			record = upsert.record;
		}

		const absPath = join(manager.RootPath(), documentContentPath(record.document));
		const editor = process.env.EDITOR || "vi";
		if (process.env.TMDOC_SKIP_EDITOR !== "1") {
			const result = spawnSync(editor, [absPath], { stdio: "inherit" });
			if (result.error) {
				throw result.error;
			}
			if (result.status !== 0) {
				throw new Error(`editor exited with status ${result.status}`);
			}
		}

		const renamedPath = await manager.Documents().AutoRenamePath(record.path);
		console.log(renamedPath);
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
