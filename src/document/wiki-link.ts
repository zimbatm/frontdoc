export interface WikiLink {
	raw: string;
	idToken: string;
	title?: string;
	collectionPrefix?: string;
	invalidReason?: string;
}

export function parseWikiLinks(content: string): WikiLink[] {
	const links: WikiLink[] = [];
	const re = /\[\[([^\]]*)\]\]/g;
	let match = re.exec(content);
	while (match !== null) {
		const inner = match[1].trim();
		const parsed = parseSingleWikiLink(inner);
		if (!parsed) {
			links.push({
				raw: inner,
				idToken: "",
				invalidReason: "empty or malformed wiki link",
			});
		} else {
			links.push(parsed);
		}
		match = re.exec(content);
	}
	return links;
}

export function parseSingleWikiLink(inner: string): WikiLink | null {
	if (inner.length === 0) return null;
	if (inner.length > 200) {
		return { raw: inner, idToken: "", invalidReason: "wiki link exceeds 200 characters" };
	}
	if (inner.includes("[[") || inner.includes("]]")) {
		return { raw: inner, idToken: "", invalidReason: "nested brackets are not allowed" };
	}

	const [lhs, title] = inner.split(":", 2);
	const rawTarget = lhs.trim();
	if (rawTarget.length === 0) {
		return { raw: inner, idToken: "", invalidReason: "wiki link id is empty" };
	}
	const [collectionPrefix, token] = rawTarget.includes("/")
		? [rawTarget.split("/")[0], rawTarget.split("/").slice(1).join("/")]
		: [undefined, rawTarget];
	const idToken = token.trim();
	if (idToken.length === 0) {
		return { raw: inner, idToken: "", invalidReason: "wiki link id is empty" };
	}
	return {
		raw: inner,
		idToken,
		title: title?.trim() || undefined,
		collectionPrefix,
	};
}
