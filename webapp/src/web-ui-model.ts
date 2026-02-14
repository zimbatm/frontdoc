export type RouteKind = "all" | "recent" | "validation" | "collection" | "doc";

export type ParsedRoute =
	| { kind: "all" }
	| { kind: "recent" }
	| { kind: "validation" }
	| { kind: "collection"; collection: string }
	| { kind: "doc"; collection: string; docKey: string };

export interface RouteDocInput {
	collection: string;
	path: string;
}

export function parseRoutePath(pathname: string): ParsedRoute {
	if (pathname === "/recent") return { kind: "recent" };
	if (pathname === "/validation") return { kind: "validation" };
	const docMatch = pathname.match(/^\/c\/([^/]+)\/(.+)$/);
	if (docMatch) {
		return {
			kind: "doc",
			collection: decodeURIComponent(docMatch[1]),
			docKey: decodeURIComponent(docMatch[2]),
		};
	}
	const colMatch = pathname.match(/^\/c\/([^/]+)$/);
	if (colMatch) {
		return { kind: "collection", collection: decodeURIComponent(colMatch[1]) };
	}
	return { kind: "all" };
}

export function routeKeyFromPath(collection: string, path: string): string {
	const prefix = `${collection}/`;
	const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	return relative.endsWith(".md") ? relative.slice(0, -3) : relative;
}

export function buildDocRoute(doc: RouteDocInput): string {
	const key = routeKeyFromPath(doc.collection, doc.path);
	return `/c/${encodeURIComponent(doc.collection)}/${encodeURIComponent(key)}`;
}
