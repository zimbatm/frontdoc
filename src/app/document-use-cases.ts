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

interface ValidationPort {
	Check(options: {
		collection?: string;
		fix?: boolean;
		pruneAttachments?: boolean;
	}): Promise<{
		issues: Array<{ severity: "error" | "warning"; path: string; code: string; message: string }>;
	}>;
}

interface ManagerPort {
	Documents(): DocumentsPort;
	Validation(): ValidationPort;
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
	const record = await manager.Documents().Create(options);
	if (!options.skipValidation) {
		await assertNoValidationErrorsForPath(manager, record.path);
	}
	return record;
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
	const record = await manager.Documents().UpdateByID(options.id, {
		fields: options.fields,
		unsetFields: options.unsetFields,
		content: options.content,
		skipValidation: options.skipValidation,
	});
	if (!options.skipValidation) {
		await assertNoValidationErrorsForPath(manager, record.path);
	}
	return record;
}

export function collectionFromPath(path: string): string {
	return pathCollectionFromPath(path);
}

export async function assertNoValidationErrorsForPath(
	manager: ManagerPort,
	path: string,
): Promise<void> {
	const collection = collectionFromPath(path);
	const result = await manager.Validation().Check({
		collection,
		fix: false,
		pruneAttachments: false,
	});
	const errors = result.issues.filter((issue) => issue.path === path && issue.severity === "error");
	if (errors.length === 0) {
		return;
	}
	const details = errors.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
	throw new Error(`validation failed: ${details}`);
}
