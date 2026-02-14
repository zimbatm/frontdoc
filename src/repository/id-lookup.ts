import { collectionFromPath } from "../document/path-utils.js";
import type { DocumentRecord } from "./repository.js";

export function findByIDInRecords(records: DocumentRecord[], idInput: string): DocumentRecord {
	const { collectionScope, partialID } = splitIDInput(idInput);
	const needle = partialID.toLowerCase();
	const matches: DocumentRecord[] = [];

	for (const record of records) {
		if (collectionScope) {
			const collection = collectionFromPath(record.path);
			if (collection !== collectionScope) {
				continue;
			}
		}

		const metadataID = String(record.document.metadata._id ?? "").toLowerCase();
		if (matchesMetadataID(metadataID, needle)) {
			matches.push(record);
		}
	}

	if (matches.length === 0) {
		throw new Error(`no document found for id: ${idInput}`);
	}
	if (matches.length > 1) {
		throw new Error(`multiple documents match id: ${idInput}`);
	}
	return matches[0];
}

export function splitIDInput(input: string): { collectionScope: string | null; partialID: string } {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		throw new Error("document id must not be empty");
	}

	const slashIndex = trimmed.indexOf("/");
	if (slashIndex === -1) {
		return { collectionScope: null, partialID: trimmed };
	}

	const collectionScope = trimmed.slice(0, slashIndex);
	const partialID = trimmed.slice(slashIndex + 1);
	if (collectionScope.length === 0 || partialID.length === 0) {
		throw new Error(`invalid id format: ${input}`);
	}

	return { collectionScope, partialID };
}

export function matchesMetadataID(metadataID: string, needle: string): boolean {
	if (metadataID.length === 0 || needle.length === 0) {
		return false;
	}
	if (metadataID === needle || metadataID.startsWith(needle)) {
		return true;
	}

	for (let n = 4; n <= 16; n++) {
		if (metadataID.length < n) {
			continue;
		}
		const shortID = metadataID.slice(-n);
		if (shortID.startsWith(needle)) {
			return true;
		}
	}

	return false;
}
