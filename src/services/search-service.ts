import { extractTitleFromContent } from "../document/document.js";
import { collectionFromPath } from "../document/path-utils.js";
import {
	type DocumentRecord,
	excludeTemplatesFilter,
	type Repository,
} from "../repository/repository.js";

export interface SearchMatch {
	field: string;
	context: string;
	line?: number;
}

export interface SearchResult {
	document: DocumentRecord;
	matches: SearchMatch[];
	score: number;
	tier: number;
	matchCount: number;
}

interface QueryExpression {
	field: string | null;
	op: ":" | "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
	value: string;
}

export class SearchService {
	constructor(private readonly repository: Repository) {}

	async UnifiedSearch(query: string): Promise<SearchResult[]> {
		const expressions = parseQuery(query);
		if (expressions.some((e) => e.field !== null)) {
			return await this.QuerySearch(expressions);
		}
		return await this.ScoredFullTextSearch(query);
	}

	MatchesQuery(record: DocumentRecord, query: string): boolean {
		const expressions = parseQuery(query);
		const matches: SearchMatch[] = [];
		for (const expr of expressions) {
			if (!evaluateExpression(record, expr, matches)) {
				return false;
			}
		}
		return true;
	}

	async QuerySearch(expressionsOrQuery: QueryExpression[] | string): Promise<SearchResult[]> {
		const expressions =
			typeof expressionsOrQuery === "string" ? parseQuery(expressionsOrQuery) : expressionsOrQuery;
		const docs = await this.repository.collectAll(excludeTemplatesFilter());
		const results: SearchResult[] = [];

		for (const record of docs) {
			const matches: SearchMatch[] = [];
			let ok = true;
			for (const expr of expressions) {
				if (!evaluateExpression(record, expr, matches)) {
					ok = false;
					break;
				}
			}
			if (ok) {
				results.push({
					document: record,
					matches,
					score: 1,
					tier: 1,
					matchCount: matches.length,
				});
			}
		}

		return sortResults(results);
	}

	async ScoredFullTextSearch(query: string): Promise<SearchResult[]> {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const words = splitWords(q);
		const docs = await this.repository.collectAll(excludeTemplatesFilter());
		const results: SearchResult[] = [];

		for (const record of docs) {
			const scored = scoreDocument(record, q, words);
			if (scored) {
				results.push(scored);
			}
		}

		return sortResults(results);
	}

	async GetTopResult(query: string): Promise<{
		topResult: SearchResult | null;
		ambiguousResults: SearchResult[];
	}> {
		const results = await this.UnifiedSearch(query);
		if (results.length === 0) {
			return { topResult: null, ambiguousResults: [] };
		}
		if (results.length === 1) {
			return { topResult: results[0], ambiguousResults: [] };
		}
		if (results[0].tier < results[1].tier) {
			return { topResult: results[0], ambiguousResults: [] };
		}
		const topTier = results[0].tier;
		const ambiguous = results.filter((r) => r.tier === topTier);
		return { topResult: null, ambiguousResults: ambiguous };
	}
}

function parseQuery(query: string): QueryExpression[] {
	const tokens = splitTokens(query);
	return tokens.map(parseExpression);
}

function splitTokens(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	while (i < input.length) {
		while (i < input.length && /\s/.test(input[i])) i++;
		if (i >= input.length) break;

		if (input[i] === '"' || input[i] === "'") {
			const quote = input[i++];
			let value = "";
			while (i < input.length && input[i] !== quote) {
				value += input[i++];
			}
			if (i < input.length && input[i] === quote) i++;
			tokens.push(value);
			continue;
		}

		let value = "";
		while (i < input.length && !/\s/.test(input[i])) {
			value += input[i++];
		}
		tokens.push(value);
	}
	return tokens;
}

function parseExpression(token: string): QueryExpression {
	for (const op of ["!=", ">=", "<=", ":", "=", ">", "<"] as const) {
		const idx = token.indexOf(op);
		if (idx > 0) {
			return {
				field: token.slice(0, idx),
				op,
				value: stripQuotes(token.slice(idx + op.length)),
			};
		}
	}
	return { field: null, op: "contains", value: stripQuotes(token) };
}

function stripQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function evaluateExpression(
	record: DocumentRecord,
	expr: QueryExpression,
	matches: SearchMatch[],
): boolean {
	if (expr.field === null) {
		const needle = expr.value.toLowerCase();
		const content = record.document.content.toLowerCase();
		const virtualTitle = extractTitleFromContent(record.document.content).toLowerCase();
		const title = String(record.document.metadata.title ?? "").toLowerCase();
		const name = String(record.document.metadata.name ?? "").toLowerCase();
		if (
			content.includes(needle) ||
			virtualTitle.includes(needle) ||
			title.includes(needle) ||
			name.includes(needle)
		) {
			matches.push({ field: "content", context: expr.value });
			return true;
		}
		return false;
	}

	const value = getFieldValue(record, expr.field);
	const target = parseTyped(expr.value);
	return compare(value, target, expr.op, expr.field, matches);
}

function getFieldValue(record: DocumentRecord, field: string): unknown {
	if (field === "collection") {
		return collectionFromPath(record.path);
	}
	return record.document.metadata[field];
}

function parseTyped(value: string): unknown {
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
	return value;
}

function compare(
	left: unknown,
	right: unknown,
	op: QueryExpression["op"],
	field: string,
	matches: SearchMatch[],
): boolean {
	if (left === undefined || left === null) return false;

	if (op === ":" || op === "=") {
		if (typeof left === "number" && typeof right === "number") {
			if (left === right) {
				matches.push({ field, context: String(left) });
				return true;
			}
			return false;
		}
		const leftText = String(left).toLowerCase();
		const rightText = String(right).toLowerCase();
		if (leftText === rightText) {
			matches.push({ field, context: String(left) });
			return true;
		}
		if (leftText.includes(",")) {
			const parts = leftText.split(",").map((p) => p.trim());
			if (parts.includes(rightText)) {
				matches.push({ field, context: String(left) });
				return true;
			}
		}
		return false;
	}
	if (op === "!=") {
		return !compare(left, right, "=", field, matches);
	}

	const a = toComparable(left);
	const b = toComparable(right);
	if (a === null || b === null) return false;

	const ok =
		op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : op === "<=" ? a <= b : false;
	if (ok) {
		matches.push({ field, context: String(left) });
	}
	return ok;
}

function toComparable(value: unknown): number | string | null {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const asNum = Number(value);
		if (!Number.isNaN(asNum)) return asNum;
		return value.toLowerCase();
	}
	if (typeof value === "boolean") return value ? 1 : 0;
	return null;
}

function scoreDocument(
	record: DocumentRecord,
	fullQuery: string,
	words: string[],
): SearchResult | null {
	const matches: SearchMatch[] = [];
	const path = record.path.toLowerCase();
	const content = record.document.content.toLowerCase();
	const name = String(record.document.metadata.name ?? "").toLowerCase();
	const virtualTitle = extractTitleFromContent(record.document.content).toLowerCase();
	const title = String(record.document.metadata.title ?? "").toLowerCase();
	const metadataStrings = Object.entries(record.document.metadata)
		.filter(([, v]) => typeof v === "string")
		.map(([k, v]) => [k, String(v).toLowerCase()] as const);

	// Tier 1
	if (name === fullQuery || virtualTitle === fullQuery || title === fullQuery) {
		const field = name === fullQuery ? "name" : virtualTitle === fullQuery ? "_title" : "title";
		matches.push({ field, context: fullQuery });
		return mkResult(record, matches, 1);
	}

	// Tier 2
	for (const [field, value] of metadataStrings) {
		if (value.includes(fullQuery)) {
			matches.push({ field, context: fullQuery });
		}
	}
	if (matches.length > 0) return mkResult(record, matches, 2);

	// Tier 3
	if (path.includes(fullQuery)) {
		matches.push({ field: "path", context: fullQuery });
		return mkResult(record, matches, 3);
	}

	// Tier 4
	if (content.includes(fullQuery)) {
		const lines = record.document.content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(fullQuery)) {
				matches.push({ field: "content", context: lines[i], line: i + 1 });
			}
		}
		if (matches.length > 0) return mkResult(record, matches, 4);
	}

	// Tier 5/6
	let tier5Count = 0;
	let tier6Count = 0;
	for (const word of words) {
		const inMetadata = metadataStrings.some(([, v]) => v.includes(word));
		const inContent = content.includes(word);
		if (inMetadata || inContent) {
			if (word.length >= 3) tier5Count++;
			else tier6Count++;
		}
	}
	if (tier5Count > 0) {
		matches.push({ field: "content", context: words.join(" ") });
		return mkResult(record, matches, 5, tier5Count);
	}
	if (tier6Count > 0) {
		matches.push({ field: "content", context: words.join(" ") });
		return mkResult(record, matches, 6, tier6Count);
	}

	return null;
}

function mkResult(
	record: DocumentRecord,
	matches: SearchMatch[],
	tier: number,
	matchCount = matches.length,
): SearchResult {
	return {
		document: record,
		matches,
		score: 1 / tier,
		tier,
		matchCount,
	};
}

function splitWords(value: string): string[] {
	return value.split(/\s+/).filter(Boolean);
}

function sortResults(results: SearchResult[]): SearchResult[] {
	return [...results].sort((a, b) => {
		if (a.tier !== b.tier) return a.tier - b.tier;
		if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
		const aID = String(a.document.document.metadata._id ?? "");
		const bID = String(b.document.document.metadata._id ?? "");
		return bID.localeCompare(aID);
	});
}
