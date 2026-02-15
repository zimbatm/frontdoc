import { dirname } from "node:path";
import type { FileInfo, VFS } from "../storage/vfs.js";
import { buildDocument, type Document, parseDocument } from "./document.js";

export interface LoadedDocumentRecord {
	document: Document;
	path: string;
	info: FileInfo;
}

export async function loadDocumentRecordByPath(
	vfs: VFS,
	path: string,
	indexFile = "index.md",
): Promise<LoadedDocumentRecord> {
	const isFolder = await vfs.isDir(path);
	const docContentPath = isFolder ? `${path}/${indexFile}` : path;
	const raw = await vfs.readFile(docContentPath);
	const document = parseDocument(raw, path, isFolder);
	const info = await vfs.stat(path);
	return { document, path, info };
}

export async function saveDocument(vfs: VFS, doc: Document, indexFile = "index.md"): Promise<void> {
	const docContentPath = doc.isFolder ? `${doc.path}/${indexFile}` : doc.path;
	const parent = dirname(docContentPath);
	if (parent !== ".") {
		await vfs.mkdirAll(parent);
	}
	await vfs.writeFile(docContentPath, buildDocument(doc));
}
