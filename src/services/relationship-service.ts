import { writeFile as writeHostFile } from "node:fs/promises";
import type { CollectionSchema } from "../config/types.js";
import { extractTitleFromContent } from "../document/document.js";
import { parseWikiLinks } from "../document/wiki-link.js";
import { collectionFromPath } from "../document/path-utils.js";
import { findByIDInRecords } from "../repository/id-lookup.js";
import {
	type DocumentRecord,
	excludeTemplatesFilter,
	type Repository,
} from "../repository/repository.js";

export type EdgeType = "wiki" | "reference";

export interface RelationshipEdge {
	from: string;
	to: string;
	type: EdgeType;
	field?: string;
}

export interface RelationshipView {
	target: DocumentRecord;
	outgoing: RelationshipEdge[];
	incoming: RelationshipEdge[];
}

export type HostFileWriter = (path: string, content: string) => Promise<void>;

export class RelationshipService {
	constructor(
		private readonly schemas: Map<string, CollectionSchema>,
		private readonly repository: Repository,
		private readonly hostFileWriter: HostFileWriter = defaultHostFileWriter,
	) {}

	async GetRelationships(id: string): Promise<RelationshipView> {
		const all = await this.repository.collectAll(excludeTemplatesFilter());
		const target = findByIDInRecords(all, id);
		const outgoing = await this.extractOutgoing(target, all);
		const incoming = this.extractIncoming(target, all);
		return { target, outgoing, incoming };
	}

	async BuildGraph(scope?: string): Promise<RelationshipEdge[]> {
		const all = await this.repository.collectAll(excludeTemplatesFilter());
		if (!scope) {
			return await this.extractAllEdges(all);
		}

		const collectionNames = new Set(this.schemas.keys());
		if (collectionNames.has(scope)) {
			const scoped = all.filter((r) => collectionFromPath(r.path) === scope);
			return await this.extractAllEdges(scoped, all);
		}

		// try as id scope
		try {
			const center = findByIDInRecords(all, scope);
			const edges = await this.extractOutgoing(center, all);
			for (const edge of this.extractIncoming(center, all)) {
				edges.push(edge);
			}
			return dedupeEdges(edges);
		} catch {
			return await this.extractAllEdges(all);
		}
	}

	ToDot(edges: RelationshipEdge[]): string {
		const lines = ["digraph tmdoc {"];
		for (const edge of edges) {
			const style = edge.type === "wiki" ? "solid" : "dashed";
			const label = edge.field
				? ` [label="${escapeLabel(edge.field)}", style=${style}]`
				: ` [style=${style}]`;
			lines.push(`  "${edge.from}" -> "${edge.to}"${label};`);
		}
		lines.push("}");
		return lines.join("\n");
	}

	ToMermaid(edges: RelationshipEdge[]): string {
		const lines = ["graph TD"];
		for (const edge of edges) {
			const arrow = edge.type === "wiki" ? "-->" : "-.->";
			const label = edge.field ? `|${edge.field}|` : "";
			lines.push(`  ${safeNode(edge.from)} ${arrow}${label} ${safeNode(edge.to)}`);
		}
		return lines.join("\n");
	}

	async WriteGraphFile(path: string, content: string): Promise<void> {
		await this.hostFileWriter(path, content);
	}

	async Stats(): Promise<{ total: number; byCollection: Record<string, number> }> {
		const docs = await this.repository.collectAll(excludeTemplatesFilter());
		const byCollection: Record<string, number> = {};
		for (const doc of docs) {
			const collection = collectionFromPath(doc.path);
			byCollection[collection] = (byCollection[collection] ?? 0) + 1;
		}
		return { total: docs.length, byCollection };
	}

	private async extractAllEdges(
		docs: DocumentRecord[],
		searchPool?: DocumentRecord[],
	): Promise<RelationshipEdge[]> {
		const pool = searchPool ?? docs;
		const edges: RelationshipEdge[] = [];
		for (const doc of docs) {
			edges.push(...(await this.extractOutgoing(doc, pool)));
		}
		return dedupeEdges(edges);
	}

	private async extractOutgoing(
		record: DocumentRecord,
		all: DocumentRecord[],
	): Promise<RelationshipEdge[]> {
		const edges: RelationshipEdge[] = [];
		const from = idOf(record);

		for (const wiki of parseWikiLinks(record.document.content)) {
			const target = findByIDToken(all, wiki.idToken);
			if (!target) continue;
			edges.push({ from, to: idOf(target), type: "wiki" });
		}

		const collection = collectionFromPath(record.path);
		const schema = this.schemas.get(collection);
		if (!schema) return edges;
		for (const [field, _targetCollection] of Object.entries(schema.references)) {
			const value = record.document.metadata[field];
			if (typeof value !== "string" || !value) continue;
			const target = findByIDToken(all, value);
			if (!target) continue;
			edges.push({ from, to: idOf(target), type: "reference", field });
		}

		return edges;
	}

	private extractIncoming(target: DocumentRecord, all: DocumentRecord[]): RelationshipEdge[] {
		const targetID = String(target.document.metadata._id ?? "");
		const shortID = shortIDOf(targetID);
		const targetCollection = collectionFromPath(target.path);
		const targetName = String(
			target.document.metadata.name ??
				target.document.metadata._title ??
				extractTitleFromContent(target.document.content) ??
				target.document.metadata.title ??
				"",
		).toLowerCase();
		const edges: RelationshipEdge[] = [];

		for (const record of all) {
			if (record.path === target.path) continue;
			const from = idOf(record);

			for (const wiki of parseWikiLinks(record.document.content)) {
				if (matchesTarget(wiki.idToken, targetID, shortID, targetCollection, targetName)) {
					edges.push({ from, to: targetID, type: "wiki" });
				}
			}

			for (const [field, value] of Object.entries(record.document.metadata)) {
				if (!field.endsWith("_id") || typeof value !== "string") continue;
				if (matchesTarget(value, targetID, shortID, targetCollection, targetName)) {
					edges.push({ from, to: targetID, type: "reference", field });
				}
			}
		}

		return dedupeEdges(edges);
	}
}

async function defaultHostFileWriter(path: string, content: string): Promise<void> {
	await writeHostFile(path, content, "utf8");
}

function findByIDToken(records: DocumentRecord[], token: string): DocumentRecord | null {
	const n = token.toLowerCase();
	const matches = records.filter((record) => {
		const id = String(record.document.metadata._id ?? "").toLowerCase();
		if (!id) return false;
		if (id === n || id.startsWith(n)) return true;
		const sid = shortIDOf(id).toLowerCase();
		return sid.startsWith(n);
	});
	if (matches.length !== 1) return null;
	return matches[0];
}

function matchesTarget(
	candidate: string,
	fullID: string,
	shortID: string,
	targetCollection: string,
	targetName: string,
): boolean {
	const c = candidate.toLowerCase();
	if (c === fullID.toLowerCase()) return true;
	if (shortID?.toLowerCase().startsWith(c)) return true;
	if (targetName && c === `${targetCollection}/${targetName}`) return true;
	if (targetName && c === targetName) return true;
	return false;
}

function idOf(record: DocumentRecord): string {
	return String(record.document.metadata._id ?? record.path);
}

function shortIDOf(id: string, length = 6): string {
	if (!id) return "";
	return id.length >= length ? id.slice(-length) : id;
}

function dedupeEdges(edges: RelationshipEdge[]): RelationshipEdge[] {
	const seen = new Set<string>();
	const out: RelationshipEdge[] = [];
	for (const edge of edges) {
		const key = `${edge.from}|${edge.to}|${edge.type}|${edge.field ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(edge);
	}
	return out;
}

function safeNode(id: string): string {
	return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(value: string): string {
	return value.replace(/"/g, '\\"');
}
