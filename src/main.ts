#!/usr/bin/env bun
import { resolve } from "node:path";
import { Command } from "commander";
import { stringify } from "yaml";
import { Manager } from "./manager.js";
import { formatSchemaReadText, formatSchemaShowText } from "./services/schema-service.js";

type SchemaOutputFormat = "text" | "json" | "yaml";

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
