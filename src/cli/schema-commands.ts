import { resolve } from "node:path";
import { Command } from "commander";
import { stringify } from "yaml";
import { Manager } from "../manager.js";
import { formatSchemaReadText, formatSchemaShowText } from "../services/schema-service.js";
import { withWriteLock } from "../app/write-lock.js";

type SchemaOutputFormat = "text" | "json" | "yaml";

export function registerSchemaCommands(program: Command): void {
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
		.option("--title-field <name>", "Field used as display title in UI")
		.option("-o, --output <format>", "Output format: text|json|yaml", "text")
		.action(
			async (
				collection: string,
				opts: {
					prefix?: string;
					slug?: string;
					shortIdLength?: number;
					titleField?: string;
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
						titleField: opts.titleField,
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
		.option("--title-field <name>", "Field used as display title in UI")
		.option("-o, --output <format>", "Output format: text|json|yaml", "text")
		.action(
			async (
				collection: string,
				opts: {
					prefix?: string;
					slug?: string;
					shortIdLength?: number;
					titleField?: string;
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
						titleField: opts.titleField,
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
}

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
	const normalized = value.trim().toLowerCase();
	if (["true", "1", "yes", "y", "on"].includes(normalized)) {
		return true;
	}
	if (["false", "0", "no", "n", "off"].includes(normalized)) {
		return false;
	}
	throw new Error(`invalid boolean: ${value}`);
}

function splitCSV(value: string): string[] {
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}
