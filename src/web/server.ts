import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	collectionFromPath,
	createDocumentUseCase,
	defaultSlugArgsForSchema,
	listDocumentsUseCase,
	normalizeFieldsForSchema,
	updateDocumentUseCase,
} from "../app/document-use-cases.js";
import { withWriteLock } from "../app/write-lock.js";
import type { CollectionSchema } from "../config/types.js";
import { buildDocument, displayName, parseDocument } from "../document/document.js";
import type { Manager } from "../manager.js";
import type { DocumentRecord } from "../repository/repository.js";

export interface WebServerOptions {
	host: string;
	port: number;
	open: boolean;
	collections?: string[];
}

interface WebListItem {
	id: string;
	shortId: string;
	collection: string;
	path: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

interface DraftState {
	targetPath: string;
	baselineRaw: string;
}

const WEB_UI_STATIC_DIR = fileURLToPath(new URL("./static/", import.meta.url));

export async function runWebServer(manager: Manager, opts: WebServerOptions): Promise<void> {
	const allowedCollections = resolveAllowedCollections(manager, opts.collections ?? []);
	const initialCollection = allowedCollections.length > 0 ? allowedCollections[0] : null;
	const drafts = new Map<string, DraftState>();

	const server = Bun.serve({
		hostname: opts.host,
		port: opts.port,
		fetch: async (req) => {
			return await handleRequest(req, manager, initialCollection, allowedCollections, drafts);
		},
		error: (error) => {
			return json(500, { error: error.message });
		},
	});

	const base = new URL(`http://${server.hostname}:${server.port}/`);
	if (initialCollection) {
		base.pathname = `/c/${encodeURIComponent(initialCollection)}`;
	}
	const url = base.toString();
	console.log(url);
	if (opts.open) {
		tryOpenBrowser(url);
	}

	await waitForShutdownSignal();
	server.stop(true);
}

async function handleRequest(
	req: Request,
	manager: Manager,
	initialCollection: string | null,
	allowedCollections: string[],
	drafts: Map<string, DraftState>,
): Promise<Response> {
	const url = new URL(req.url);
	const pathname = url.pathname;

	if (pathname === "/api/collections" && req.method === "GET") {
		return await handleCollections(manager, allowedCollections);
	}

	if (pathname === "/api/documents" && req.method === "GET") {
		return await handleDocumentsList(manager, url, allowedCollections);
	}

	if (pathname === "/api/documents" && req.method === "POST") {
		return await handleCreateDocument(req, manager, allowedCollections, drafts);
	}

	if (pathname.startsWith("/api/documents/")) {
		const attachmentRoute = parseAttachmentRoute(pathname);
		if (attachmentRoute && req.method === "POST") {
			return await handleUploadAttachment(req, manager, attachmentRoute.id, allowedCollections);
		}
		const id = decodeURIComponent(pathname.slice("/api/documents/".length));
		if (req.method === "GET") {
			return await handleReadDocument(manager, id, allowedCollections, drafts);
		}
		if (req.method === "PUT") {
			return await handleUpdateDocument(req, manager, id, allowedCollections, drafts);
		}
		if (req.method === "DELETE") {
			return await handleDeleteDocument(manager, id, allowedCollections, drafts);
		}
	}

	if (pathname === "/api/check" && req.method === "POST") {
		return await handleCheck(req, manager, allowedCollections);
	}

	if (pathname.startsWith("/api/")) {
		return json(404, { error: "not found" });
	}

	const staticAsset = await serveStaticUiAsset(pathname);
	if (staticAsset) {
		return staticAsset;
	}

	const docRoute = parseCollectionDocumentRoute(pathname);
	if (docRoute) {
		const scope = collectionScopeSet(allowedCollections);
		if (isCollectionAllowed(docRoute.collection, scope)) {
			const redirectPath = await resolveCanonicalDocumentRoute(
				manager,
				docRoute.collection,
				docRoute.target,
			);
			if (redirectPath) {
				return Response.redirect(redirectPath, 302);
			}
		}
	}

	return await serveWebUiShell(initialCollection);
}

async function serveWebUiShell(initialCollection: string | null): Promise<Response> {
	const indexFile = Bun.file(join(WEB_UI_STATIC_DIR, "index.html"));
	if (await indexFile.exists()) {
		return new Response(indexFile, {
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	}
	const hint = initialCollection ? ` (initial collection: ${initialCollection})` : "";
	return json(500, {
		error: `web UI bundle not found at src/web/static/index.html${hint}`,
	});
}

async function serveStaticUiAsset(pathname: string): Promise<Response | null> {
	if (!pathname.startsWith("/ui/")) {
		return null;
	}
	const relative = pathname.slice("/ui/".length);
	const segments = relative.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
		return new Response("not found", { status: 404 });
	}

	const targetPath = join(WEB_UI_STATIC_DIR, ...segments);
	const file = Bun.file(targetPath);
	if (!(await file.exists())) {
		return new Response("not found", { status: 404 });
	}

	return new Response(file, {
		headers: {
			"content-type": contentTypeForPath(targetPath),
			"cache-control": "no-store",
		},
	});
}

function contentTypeForPath(path: string): string {
	const extension = extname(path).toLowerCase();
	switch (extension) {
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".ico":
			return "image/x-icon";
		default:
			return "application/octet-stream";
	}
}

async function handleCollections(
	manager: Manager,
	allowedCollections: string[],
): Promise<Response> {
	const docs = await manager.Documents().List();
	const counts = new Map<string, number>();
	for (const doc of docs) {
		const collection = collectionFromPath(doc.path);
		counts.set(collection, (counts.get(collection) ?? 0) + 1);
	}
	const aliases = manager.Aliases();
	const scope = collectionScopeSet(allowedCollections);
	const collections = Array.from(manager.Schemas().entries())
		.filter(([name]) => isCollectionAllowed(name, scope))
		.map(([name, schema]) => {
			const aliasList = Object.entries(aliases)
				.filter(([, target]) => target === name)
				.map(([alias]) => alias)
				.sort((a, b) => a.localeCompare(b));
			return {
				name,
				aliases: aliasList,
				count: counts.get(name) ?? 0,
				schema,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	return json(200, { collections });
}

async function handleDocumentsList(
	manager: Manager,
	url: URL,
	allowedCollections: string[],
): Promise<Response> {
	const collection = url.searchParams.get("collection");
	const query = url.searchParams.get("query");
	const scope = collectionScopeSet(allowedCollections);
	if (collection && !isCollectionAllowed(manager.Documents().ResolveCollection(collection), scope)) {
		return json(200, { documents: [] });
	}
	let docs = await listDocumentsUseCase(manager, { collection: collection ?? undefined, query: query ?? undefined });
	docs = docs.filter((record) => isCollectionAllowed(collectionFromPath(record.path), scope));
	const documents = docs.map((record) => listItemFromRecord(record, manager.Schemas()));
	return json(200, { documents });
}

async function handleReadDocument(
	manager: Manager,
	id: string,
	allowedCollections: string[],
	drafts: Map<string, DraftState>,
): Promise<Response> {
	try {
		const draftPath = draftPathFromEditID(id);
		if (draftPath) {
			const draft = drafts.get(draftPath);
			if (!draft) {
				return json(404, { error: `draft not found: ${id}` });
			}
			const collection = collectionFromPath(draftPath);
			if (!isCollectionAllowed(collection, collectionScopeSet(allowedCollections))) {
				return json(404, { error: `collection not served: ${collection}` });
			}
			const record = await loadByPath(manager, draftPath);
			const schema = manager.Schemas().get(collection) ?? null;
			const document = {
				...listItemFromRecord(record, manager.Schemas()),
				id: draftEditID(draftPath),
				metadata: record.document.metadata,
				content: record.document.content,
				isFolder: record.document.isFolder,
				schema,
				draft: true,
			};
			return json(200, { document });
		}

		const record = await manager.Documents().ReadByID(id);
		const collection = collectionFromPath(record.path);
		if (!isCollectionAllowed(collection, collectionScopeSet(allowedCollections))) {
			return json(404, { error: `collection not served: ${collection}` });
		}
		const schema = manager.Schemas().get(collection) ?? null;
		const document = {
			...listItemFromRecord(record, manager.Schemas()),
			metadata: record.document.metadata,
			content: record.document.content,
			isFolder: record.document.isFolder,
			schema,
		};
		return json(200, { document });
	} catch (error) {
		return json(404, { error: message(error) });
	}
}

async function handleCreateDocument(
	req: Request,
	manager: Manager,
	allowedCollections: string[],
	drafts: Map<string, DraftState>,
): Promise<Response> {
	try {
		const body = await readJSON(req);
		const collectionRaw = asNonEmptyString(body.collection, "collection");
		const collection = manager.Documents().ResolveCollection(collectionRaw);
		if (!isCollectionAllowed(collection, collectionScopeSet(allowedCollections))) {
			return json(400, { error: `collection not served: ${collection}` });
		}
		const schema = manager.Schemas().get(collection);
		if (!schema) {
			return json(400, { error: `unknown collection: ${collectionRaw}` });
		}
		const openDefaults = Boolean(body.openDefaults);
		if (openDefaults) {
			const openDefaultArgs = resolveOpenDefaultsArgs(schema);
			let templateResolved = false;
			let templateContent: string | undefined;
			const resolveTemplateContent = async (): Promise<string | undefined> => {
				if (templateResolved) {
					return templateContent;
				}
				const templates = await manager.Templates().GetTemplatesForCollection(collection);
				if (templates.length === 1) {
					templateContent = templates[0].content;
				}
				templateResolved = true;
				return templateContent;
			};
			const planned = await withWriteLock(manager, async () => {
				return await manager.Documents().PlanBySlug(collection, openDefaultArgs, {
					resolveTemplateContent,
				});
			});
			if (planned.record) {
				return json(200, {
					document: listItemFromRecord(planned.record, manager.Schemas()),
				});
			}
			if (!planned.draft) {
				throw new Error("expected draft plan for missing open target");
			}
			const targetPath = planned.draft.path;
			const draftPath = openDraftPath(targetPath, String(planned.draft.metadata._id ?? ""));
			const baselineRaw = buildDocument(planned.draft);
			const draftRecord = await withWriteLock(manager, async () => {
				await manager.Drafts().Write(draftPath, baselineRaw);
				drafts.set(draftPath, { targetPath, baselineRaw });
				return await loadByPath(manager, draftPath);
			});

			return json(201, {
				document: {
					...listItemFromRecord(draftRecord, manager.Schemas()),
					id: draftEditID(draftPath),
					metadata: draftRecord.document.metadata,
					content: draftRecord.document.content,
					isFolder: false,
					schema,
					draft: true,
				},
			});
		}
		const fields = normalizeFieldsForSchema(asRecord(body.fields), schema);
		const content = asOptionalString(body.content, "content");
		const templateContent = asOptionalString(body.templateContent, "templateContent");

		const created = await withWriteLock(manager, async () => {
			return await createDocumentUseCase(manager, {
				collection,
				fields,
				content,
				templateContent,
			});
		});

		return json(201, { document: listItemFromRecord(created, manager.Schemas()) });
	} catch (error) {
		return json(400, { error: message(error) });
	}
}

function resolveOpenDefaultsArgs(schema: CollectionSchema): string[] {
	return defaultSlugArgsForSchema(schema);
}

async function handleUpdateDocument(
	req: Request,
	manager: Manager,
	id: string,
	allowedCollections: string[],
	drafts: Map<string, DraftState>,
): Promise<Response> {
	try {
		const body = await readJSON(req);
		const draftPath = draftPathFromEditID(id);
		if (draftPath) {
			const draft = drafts.get(draftPath);
			if (!draft) {
				return json(404, { error: `draft not found: ${id}` });
			}
			const collection = collectionFromPath(draftPath);
			const scope = collectionScopeSet(allowedCollections);
			if (!isCollectionAllowed(collection, scope)) {
				return json(400, { error: `collection not served: ${collection}` });
			}
			const schema = manager.Schemas().get(collection);
			if (!schema) {
				return json(400, { error: `unknown collection: ${collection}` });
			}
			const existing = await loadByPath(manager, draftPath);
			const fields = normalizeFieldsForSchema(asRecord(body.fields), schema);
			for (const [name, value] of Object.entries(fields)) {
				existing.document.metadata[name] = value;
			}
			for (const key of asStringArray(body.unsetFields, "unsetFields") ?? []) {
				delete existing.document.metadata[key];
			}
			if (body.content !== undefined) {
				existing.document.content = asOptionalString(body.content, "content") ?? "";
			}
			const raw = buildDocument(existing.document);
			if (raw === draft.baselineRaw) {
				await withWriteLock(manager, async () => {
					await manager.Drafts().RemoveIfExists(draftPath);
					drafts.delete(draftPath);
				});
				return json(200, { discarded: true });
			}
			const issues = (
				await manager.Validation().ValidateRaw(collection, draft.targetPath, raw)
			).filter((issue) => issue.code !== "filename.mismatch" && issue.code !== "filename.invalid");
			if (issues.length > 0) {
				const details = issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
				return json(400, { error: `validation failed: ${details}` });
			}
			const updated = await withWriteLock(manager, async () => {
				await manager.Drafts().Write(draft.targetPath, raw);
				await manager.Drafts().RemoveIfExists(draftPath);
				drafts.delete(draftPath);
				const renamed = await manager.Documents().AutoRenamePath(draft.targetPath);
				return await loadByPath(manager, renamed);
			});
			return json(200, { document: listItemFromRecord(updated, manager.Schemas()) });
		}

		let schema: CollectionSchema | undefined;
		const scope = collectionScopeSet(allowedCollections);
		if (body.fields) {
			const existing = await manager.Documents().ReadByID(id);
			const collection = collectionFromPath(existing.path);
			if (!isCollectionAllowed(collection, scope)) {
				return json(400, { error: `collection not served: ${collection}` });
			}
			schema = manager.Schemas().get(collection);
			if (!schema) {
				return json(400, { error: `unknown collection: ${collection}` });
			}
		}
		const update = {
			fields: schema ? normalizeFieldsForSchema(asRecord(body.fields), schema) : undefined,
			unsetFields: asStringArray(body.unsetFields, "unsetFields"),
			content: asOptionalString(body.content, "content"),
		};

		const updated = await withWriteLock(manager, async () => {
			const record = await updateDocumentUseCase(manager, {
				id,
				fields: update.fields,
				unsetFields: update.unsetFields,
				content: update.content,
			});
			const collection = collectionFromPath(record.path);
			if (!isCollectionAllowed(collection, scope)) {
				throw new Error(`collection not served: ${collection}`);
			}
			return record;
		});

		return json(200, { document: listItemFromRecord(updated, manager.Schemas()) });
	} catch (error) {
		return json(400, { error: message(error) });
	}
}

async function handleDeleteDocument(
	manager: Manager,
	id: string,
	allowedCollections: string[],
	drafts: Map<string, DraftState>,
): Promise<Response> {
	try {
		const draftPath = draftPathFromEditID(id);
		if (draftPath) {
			const collection = collectionFromPath(draftPath);
			const scope = collectionScopeSet(allowedCollections);
			if (!isCollectionAllowed(collection, scope)) {
				return json(404, { error: `collection not served: ${collection}` });
			}
			await withWriteLock(manager, async () => {
				await manager.Drafts().RemoveIfExists(draftPath);
				drafts.delete(draftPath);
			});
			return json(200, { deleted: true, draft: true });
		}
		const scope = collectionScopeSet(allowedCollections);
		await withWriteLock(manager, async () => {
			const existing = await manager.Documents().ReadByID(id);
			const collection = collectionFromPath(existing.path);
			if (!isCollectionAllowed(collection, scope)) {
				throw new Error(`collection not served: ${collection}`);
			}
			await manager.Documents().DeleteByID(id);
		});
		return json(200, { deleted: true });
	} catch (error) {
		return json(404, { error: message(error) });
	}
}

async function handleCheck(
	req: Request,
	manager: Manager,
	allowedCollections: string[],
): Promise<Response> {
	try {
		const body = await readJSON(req).catch(() => ({}));
		const collectionInput = asOptionalString(body.collection, "collection");
		const fix = Boolean(body.fix);
		const pruneAttachments = Boolean(body.pruneAttachments);
		const scope = collectionScopeSet(allowedCollections);
		const collection = collectionInput
			? manager.Documents().ResolveCollection(collectionInput)
			: undefined;
		if (collection && !isCollectionAllowed(collection, scope)) {
			return json(400, { error: `collection not served: ${collection}` });
		}
		const checks =
			collection !== undefined
				? [collection]
				: scope === null
					? [undefined]
					: [...scope.values()].sort((a, b) => a.localeCompare(b));

		const result = fix
			? await withWriteLock(manager, async () => {
					return await runChecks(manager, checks, true, pruneAttachments);
				})
			: await runChecks(manager, checks, false, false);
	return json(200, result);
	} catch (error) {
		return json(400, { error: message(error) });
	}
}

async function handleUploadAttachment(
	req: Request,
	manager: Manager,
	id: string,
	allowedCollections: string[],
): Promise<Response> {
	let tempDir = "";
	try {
		const form = await req.formData();
		const entry = form.get("file");
		if (!(entry instanceof File)) {
			return json(400, { error: "expected multipart field 'file'" });
		}
		const name = basename(entry.name || "attachment");
		if (name.length === 0) {
			return json(400, { error: "attachment filename is required" });
		}
		const addReference = parseBooleanFormValue(form.get("reference"), true);
		const force = parseBooleanFormValue(form.get("force"), false);
		const bytes = new Uint8Array(await entry.arrayBuffer());
		const scope = collectionScopeSet(allowedCollections);

		const result = await withWriteLock(manager, async () => {
			const existing = await manager.Documents().ReadByID(id);
			const collection = collectionFromPath(existing.path);
			if (!isCollectionAllowed(collection, scope)) {
				throw new Error(`collection not served: ${collection}`);
			}

			tempDir = await mkdtemp(join(tmpdir(), "frontdoc-web-upload-"));
			const tempPath = join(tempDir, name);
			await writeFile(tempPath, bytes);

			const attachmentPath = await manager.Documents().AttachFileByID(
				id,
				tempPath,
				addReference,
				force,
			);
			const updated = await manager.Documents().ReadByID(id);
			return { attachmentPath, updated };
		});

		return json(201, {
			path: result.attachmentPath,
			document: listItemFromRecord(result.updated, manager.Schemas()),
		});
	} catch (error) {
		return json(400, { error: message(error) });
	} finally {
		if (tempDir.length > 0) {
			await rm(tempDir, { recursive: true, force: true });
		}
	}
}

async function runChecks(
	manager: Manager,
	checks: Array<string | undefined>,
	fix: boolean,
	pruneAttachments: boolean,
): Promise<{ issues: unknown[]; fixed: number; scanned: number }> {
	const merged = {
		issues: [] as unknown[],
		fixed: 0,
		scanned: 0,
	};
	for (const collection of checks) {
		const result = await manager.Validation().Check({
			collection,
			fix,
			pruneAttachments,
		});
		merged.issues.push(...result.issues);
		merged.fixed += result.fixed;
		merged.scanned += result.scanned;
	}
	return merged;
}

function listItemFromRecord(
	record: DocumentRecord,
	schemas: Map<string, CollectionSchema>,
): WebListItem {
	const collection = collectionFromPath(record.path);
	const schema = schemas.get(collection);
	const id = String(record.document.metadata._id ?? "");
	const shortLength = schema?.short_id_length ?? 6;
	const shortId = id.length >= shortLength ? id.slice(-shortLength) : id;
	return {
		id,
		shortId,
		collection,
		path: record.path,
		title: displayName(record.document, schema?.slug, shortLength, schema?.title_field),
		createdAt: String(record.document.metadata._created_at ?? ""),
		updatedAt: record.info.modifiedAt.toISOString(),
	};
}

async function loadByPath(manager: Manager, path: string): Promise<DocumentRecord> {
	const raw = await manager.Repository().fileSystem().readFile(path);
	const document = parseDocument(raw, path, false);
	const info = await manager.Repository().fileSystem().stat(path);
	return { document, path, info };
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

async function readJSON(req: Request): Promise<Record<string, unknown>> {
	const text = await req.text();
	if (text.trim().length === 0) {
		return {};
	}
	const parsed = JSON.parse(text);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("expected JSON object");
	}
	return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value === undefined || value === null) {
		return {};
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("expected object");
	}
	return value as Record<string, unknown>;
}

function asStringArray(value: unknown, field: string): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new Error(`expected '${field}' to be an array`);
	}
	return value.map((entry) => String(entry));
}

function asOptionalString(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`expected '${field}' to be a string`);
	}
	return value;
}

function asNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`expected '${field}' to be a non-empty string`);
	}
	return value.trim();
}

function parseBooleanFormValue(raw: FormDataEntryValue | null, fallback: boolean): boolean {
	if (raw === null) {
		return fallback;
	}
	const value = String(raw).trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(value)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(value)) {
		return false;
	}
	throw new Error(`invalid boolean value: ${value}`);
}

function parseAttachmentRoute(pathname: string): { id: string } | null {
	if (!pathname.startsWith("/api/documents/") || !pathname.endsWith("/attachments")) {
		return null;
	}
	const encoded = pathname.slice("/api/documents/".length, -"/attachments".length);
	if (encoded.length === 0) {
		return null;
	}
	return { id: decodeURIComponent(encoded) };
}

function message(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function resolveAllowedCollections(manager: Manager, requested: string[]): string[] {
	if (requested.length === 0) {
		return [];
	}
	const resolved = new Set<string>();
	for (const input of requested) {
		const collection = manager.Documents().ResolveCollection(input);
		resolved.add(collection);
	}
	return [...resolved.values()].sort((a, b) => a.localeCompare(b));
}

function collectionScopeSet(allowedCollections: string[]): Set<string> | null {
	if (allowedCollections.length === 0) {
		return null;
	}
	return new Set(allowedCollections);
}

function isCollectionAllowed(collection: string, scope: Set<string> | null): boolean {
	return scope === null || scope.has(collection);
}

function draftPathFromEditID(id: string): string | null {
	const slash = id.indexOf("/");
	if (slash <= 0 || slash >= id.length - 1) {
		return null;
	}
	const collection = id.slice(0, slash);
	const relative = id.slice(slash + 1);
	if (!relative.startsWith(".tdo-")) {
		return null;
	}
	return `${collection}/${relative.endsWith(".md") ? relative : `${relative}.md`}`;
}

function draftEditID(draftPath: string): string {
	return draftPath.endsWith(".md") ? draftPath.slice(0, -3) : draftPath;
}

function openDraftPath(targetPath: string, id: string): string {
	const collection = collectionFromPath(targetPath);
	const base = routeTargetFromPath(collection, targetPath).split("/").pop() ?? "";
	const suffix = base.length > 0 ? base : "draft";
	const shortID = id.length >= 6 ? id.slice(-6) : "draft";
	return `${collection}/.tdo-${shortID}-${suffix}.md`;
}

function parseCollectionDocumentRoute(
	pathname: string,
): { collection: string; target: string } | null {
	const match = pathname.match(/^\/c\/([^/]+)\/(.+)$/);
	if (!match) {
		return null;
	}
	try {
		return {
			collection: decodeURIComponent(match[1]),
			target: decodeURIComponent(match[2]),
		};
	} catch {
		return null;
	}
}

async function resolveCanonicalDocumentRoute(
	manager: Manager,
	collection: string,
	target: string,
): Promise<string | null> {
	const docs = await listDocumentsUseCase(manager, { collection });
	if (docs.some((record) => routeTargetFromPath(collection, record.path) === target)) {
		return null;
	}

	try {
		const record = await manager.Documents().ReadByID(`${collection}/${target}`);
		const canonical = routeTargetFromPath(collection, record.path);
		if (canonical === target) {
			return null;
		}
		return `/c/${encodeURIComponent(collection)}/${encodeURIComponent(canonical)}`;
	} catch {
		return null;
	}
}

function routeTargetFromPath(collection: string, path: string): string {
	const prefix = `${collection}/`;
	const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	return relative.endsWith(".md") ? relative.slice(0, -3) : relative;
}

function tryOpenBrowser(url: string): void {
	for (const [cmd, args] of browserCommands(url)) {
		try {
			const result = spawnSync(cmd, args, { stdio: "ignore" });
			if (!result.error && result.status === 0) {
				return;
			}
		} catch {
			// best effort
		}
	}
}

function browserCommands(url: string): Array<[string, string[]]> {
	if (process.platform === "darwin") {
		return [["open", [url]]];
	}
	if (process.platform === "win32") {
		return [["cmd", ["/c", "start", "", url]]];
	}
	const browser = process.env.BROWSER;
	if (browser && browser.trim().length > 0) {
		return [
			[browser, [url]],
			["xdg-open", [url]],
			["gio", ["open", url]],
		];
	}
	return [
		["xdg-open", [url]],
		["gio", ["open", url]],
	];
}

async function waitForShutdownSignal(): Promise<void> {
	return await new Promise((resolve) => {
		const onSignal = () => {
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
			resolve();
		};
		process.on("SIGINT", onSignal);
		process.on("SIGTERM", onSignal);
	});
}
