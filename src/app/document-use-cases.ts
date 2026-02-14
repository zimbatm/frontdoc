import type { DocumentRecord } from "../repository/repository.js";
import { collectionFromPath as pathCollectionFromPath } from "../document/path-utils.js";

interface DocumentsPort {
	Create(options: {
		collection: string;
		fields?: Record<string, unknown>;
		content?: string;
		templateContent?: string;
		skipValidation?: boolean;
	}): Promise<DocumentRecord>;
	UpdateByID(
		id: string,
		options: {
			fields?: Record<string, unknown>;
			unsetFields?: string[];
			content?: string;
			skipValidation?: boolean;
		},
	): Promise<DocumentRecord>;
}

interface ManagerPort {
	Documents(): DocumentsPort;
}

export async function createDocumentUseCase(
	manager: ManagerPort,
	options: {
		collection: string;
		fields?: Record<string, unknown>;
		content?: string;
		templateContent?: string;
		skipValidation?: boolean;
	},
): Promise<DocumentRecord> {
	return await manager.Documents().Create(options);
}

export async function updateDocumentUseCase(
	manager: ManagerPort,
	options: {
		id: string;
		fields?: Record<string, unknown>;
		unsetFields?: string[];
		content?: string;
		skipValidation?: boolean;
	},
): Promise<DocumentRecord> {
	return await manager.Documents().UpdateByID(options.id, {
		fields: options.fields,
		unsetFields: options.unsetFields,
		content: options.content,
		skipValidation: options.skipValidation,
	});
}

export function collectionFromPath(path: string): string {
	return pathCollectionFromPath(path);
}
