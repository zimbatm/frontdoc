import { collectionFromPath } from "../document/path-utils.js";

export function searchResultsToCsv(
	results: Array<{ document: { path: string }; tier: number; score: number; matchCount: number }>,
): string {
	const lines = ["path,tier,score,match_count"];
	for (const row of results) {
		lines.push(`${csv(row.document.path)},${row.tier},${row.score},${row.matchCount}`);
	}
	return lines.join("\n");
}

export function listResultsToCsv(
	results: Array<{ path: string; document: { metadata: Record<string, unknown> } }>,
): string {
	const lines = ["path,collection,id,name"];
	for (const row of results) {
		const collection = collectionFromPath(row.path);
		const id = String(row.document.metadata._id ?? "");
		const name = String(
			row.document.metadata.name ??
				row.document.metadata._title ??
				row.document.metadata.title ??
				"",
		);
		lines.push(`${csv(row.path)},${csv(collection)},${csv(id)},${csv(name)}`);
	}
	return lines.join("\n");
}

export function listResultsToTable(
	results: Array<{ path: string; document: { metadata: Record<string, unknown> } }>,
): string {
	const rows = results.map((row) => {
		const collection = collectionFromPath(row.path);
		const id = String(row.document.metadata._id ?? "");
		const name = String(
			row.document.metadata.name ??
				row.document.metadata._title ??
				row.document.metadata.title ??
				"",
		);
		return { path: row.path, collection, id, name };
	});

	const pathWidth = Math.max("PATH".length, ...rows.map((r) => r.path.length));
	const collectionWidth = Math.max("COLLECTION".length, ...rows.map((r) => r.collection.length));
	const idWidth = Math.max("ID".length, ...rows.map((r) => r.id.length));
	const nameWidth = Math.max("NAME".length, ...rows.map((r) => r.name.length));

	const lines = [
		`${"PATH".padEnd(pathWidth)}  ${"COLLECTION".padEnd(collectionWidth)}  ${"ID".padEnd(idWidth)}  ${"NAME".padEnd(nameWidth)}`,
	];
	for (const row of rows) {
		lines.push(
			`${row.path.padEnd(pathWidth)}  ${row.collection.padEnd(collectionWidth)}  ${row.id.padEnd(idWidth)}  ${row.name.padEnd(nameWidth)}`,
		);
	}
	return lines.join("\n");
}

function csv(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
