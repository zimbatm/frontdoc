import type { RouteKind } from "../web-ui-model";
import type { SchemaFieldDefinition } from "./editor/schema-form-model";

export type EditorMode = "edit" | "preview" | "split";

export interface CollectionInfo {
	name: string;
	count: number;
}

export interface ListDoc {
	id: string;
	shortId?: string;
	collection: string;
	path: string;
	title: string;
	updatedAt: string;
}

export interface ReadDoc extends ListDoc {
	metadata: Record<string, unknown>;
	content: string;
	schema?: {
		fields?: Record<string, SchemaFieldDefinition>;
	} | null;
}

export interface ValidationIssue {
	path?: string;
	message?: string;
	severity?: string;
}

export interface ScopeInfo {
	kind: RouteKind;
	collection: string;
}
