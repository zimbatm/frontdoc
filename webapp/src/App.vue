<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { collectFieldErrors } from "./features/editor/field-validation";
import {
	buildUiSchemaFields,
	formStringValue,
	payloadValue,
	type UiSchemaField,
} from "./features/editor/schema-form-model";
import AppShell from "./features/app-shell/AppShell.vue";
import DocumentListPane from "./features/doc-list/DocumentListPane.vue";
import LeftRail from "./features/navigation/LeftRail.vue";
import type {
	CollectionInfo,
	EditorMode,
	ListDoc,
	ReadDoc,
	ValidationIssue,
} from "./features/types";
import WorkspacePane from "./features/workspace/WorkspacePane.vue";
import { buildDocRoute, parseRoutePath, routeKeyFromPath } from "./web-ui-model";

const router = useRouter();
const route = useRoute();

const modeOptions: Array<{ label: string; value: EditorMode }> = [
	{ label: "Edit", value: "edit" },
	{ label: "Preview", value: "preview" },
	{ label: "Split", value: "split" },
];

const collections = ref<CollectionInfo[]>([]);
const docs = ref<ListDoc[]>([]);
const issues = ref<ValidationIssue[]>([]);
const selectedDoc = ref<ReadDoc | null>(null);
const selectedIndex = ref(0);
const query = ref("");
const mode = ref<EditorMode>("split");
const errorMessage = ref("");
const statusMessage = ref("");
const checkSummary = ref("");
const saving = ref(false);
const uploadingAttachment = ref(false);
const fieldValues = reactive<Record<string, string>>({});
const contentValue = ref("");

const schemaFields = computed<UiSchemaField[]>(() =>
	buildUiSchemaFields(selectedDoc.value?.schema, selectedDoc.value?.metadata ?? {}),
);
const fieldErrors = computed<Record<string, string>>(() =>
	collectFieldErrors(schemaFields.value, fieldValues),
);
const hasFieldErrors = computed(() => Object.keys(fieldErrors.value).length > 0);

const routeInfo = computed(() => parseRoutePath(route.path));

const routeCollection = computed(() => {
	if (routeInfo.value.kind === "collection" || routeInfo.value.kind === "doc") {
		return routeInfo.value.collection;
	}
	return "";
});

const listEmptyLabel = computed(() => {
	if (routeInfo.value.kind === "validation") {
		return "No validation issues.";
	}
	return "No documents.";
});

const workspaceOpen = computed(() => routeInfo.value.kind === "doc");

function docRouteKey(doc: ListDoc | ReadDoc): string {
	return routeKeyFromPath(doc.collection, doc.path);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const resp = await fetch(path, init);
	if (!resp.ok) {
		const body = (await resp.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error || `HTTP ${resp.status}`);
	}
	return (await resp.json()) as T;
}

async function loadDocument(id: string): Promise<void> {
	const payload = await api<{ document: ReadDoc }>(`/api/documents/${encodeURIComponent(id)}`);
	selectedDoc.value = payload.document;
	contentValue.value = payload.document.content;
	const schemaFieldDefs = payload.document.schema?.fields ?? {};
	for (const key of Object.keys(fieldValues)) {
		delete fieldValues[key];
	}

	for (const [name, definition] of Object.entries(schemaFieldDefs)) {
		fieldValues[name] = formStringValue(definition.type, payload.document.metadata?.[name]);
	}

	for (const [key, value] of Object.entries(payload.document.metadata ?? {})) {
		if (key.startsWith("_")) continue;
		if (schemaFieldDefs[key]) continue;
		fieldValues[key] = formStringValue("string", value);
	}
}

async function refresh(): Promise<void> {
	errorMessage.value = "";
	statusMessage.value = "";
	checkSummary.value = "";

	const collectionsResp = await api<{ collections: CollectionInfo[] }>("/api/collections");
	collections.value = collectionsResp.collections;

	if (routeInfo.value.kind === "validation") {
		const result = await api<{ scanned: number; issues: ValidationIssue[] }>("/api/check", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ fix: false }),
		});
		issues.value = result.issues;
		selectedDoc.value = null;
		docs.value = [];
		checkSummary.value = `Scanned ${result.scanned}, issues ${result.issues.length}`;
		return;
	}

	issues.value = [];
	const searchParams = new URLSearchParams();
	const trimmedQuery = query.value.trim();
	if (trimmedQuery) {
		searchParams.set("query", trimmedQuery);
	}
	if (routeCollection.value) {
		searchParams.set("collection", routeCollection.value);
	}

	const docsResp = await api<{ documents: ListDoc[] }>(`/api/documents?${searchParams.toString()}`);
	const fetchedDocs = docsResp.documents;
	docs.value =
		routeInfo.value.kind === "recent"
			? fetchedDocs.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
			: fetchedDocs;

	if (selectedIndex.value >= docs.value.length) {
		selectedIndex.value = 0;
	}

	const routeState = routeInfo.value;
	if (routeState.kind !== "doc") {
		selectedDoc.value = null;
		return;
	}

	const bySlug = docs.value.find((entry) => docRouteKey(entry) === routeState.docKey);
	if (bySlug) {
		selectedIndex.value = docs.value.findIndex((entry) => entry.id === bySlug.id);
		await loadDocument(bySlug.id);
		return;
	}

	const byId = docs.value.find((entry) => entry.id === routeState.docKey);
	if (byId) {
		selectedIndex.value = docs.value.findIndex((entry) => entry.id === byId.id);
		await loadDocument(byId.id);
		await router.replace(buildDocRoute(byId));
		return;
	}

	await loadDocument(`${routeState.collection}/${routeState.docKey}`);
	if (selectedDoc.value) {
		const canonical = buildDocRoute(selectedDoc.value);
		if (canonical !== route.path) {
			await router.replace(canonical);
		}
	}
}

async function openDoc(doc: ListDoc, index: number): Promise<void> {
	selectedIndex.value = index;
	await router.push(buildDocRoute(doc));
}

async function runSearch(): Promise<void> {
	await refresh().catch((error: unknown) => {
		errorMessage.value = error instanceof Error ? error.message : String(error);
	});
}

async function createDocument(): Promise<void> {
	const preferredCollection = routeCollection.value || collections.value[0]?.name || "";
	if (!preferredCollection) return;
	try {
		const created = await api<{ document: ListDoc }>("/api/documents", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ collection: preferredCollection, openDefaults: true }),
		});
		await router.push(buildDocRoute(created.document));
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : String(error);
	}
}

async function saveDocument(): Promise<void> {
	if (!selectedDoc.value) return;
	if (hasFieldErrors.value) {
		errorMessage.value = "Please fix field validation errors.";
		return;
	}
	saving.value = true;
	statusMessage.value = "";
	try {
		const fieldsPayload: Record<string, unknown> = {};
		const typeByField = new Map(schemaFields.value.map((field) => [field.name, field.type]));
		for (const [name, value] of Object.entries(fieldValues)) {
			if (name.startsWith("_")) continue;
			fieldsPayload[name] = payloadValue(typeByField.get(name) ?? "string", value);
		}
		const payload = {
			fields: fieldsPayload,
			content: contentValue.value,
		};
		const result = await api<{ discarded?: boolean; document?: ReadDoc }>(
			`/api/documents/${encodeURIComponent(selectedDoc.value.id)}`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			},
		);
		if (result.discarded) {
			statusMessage.value = "Draft discarded.";
			await router.push(`/c/${encodeURIComponent(selectedDoc.value.collection)}`);
			return;
		}
		if (result.document) {
			statusMessage.value = "Saved.";
			await router.push(buildDocRoute(result.document));
			return;
		}
		await refresh();
		statusMessage.value = "Saved.";
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : String(error);
	} finally {
		saving.value = false;
	}
}

async function deleteDocument(): Promise<void> {
	if (!selectedDoc.value) return;
	if (!confirm("Delete this document?")) return;
	try {
		await api<{ deleted: boolean }>(`/api/documents/${encodeURIComponent(selectedDoc.value.id)}`, {
			method: "DELETE",
		});
		await router.push(`/c/${encodeURIComponent(selectedDoc.value.collection)}`);
		statusMessage.value = "Deleted.";
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : String(error);
	}
}

async function checkCollection(): Promise<void> {
	if (!selectedDoc.value) return;
	try {
		const result = await api<{ scanned: number; issues: ValidationIssue[] }>("/api/check", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ collection: selectedDoc.value.collection, fix: false }),
		});
		statusMessage.value = `Scanned ${result.scanned}, issues ${result.issues.length}`;
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : String(error);
	}
}

async function backToBrowse(): Promise<void> {
	if (selectedDoc.value) {
		await router.push(`/c/${encodeURIComponent(selectedDoc.value.collection)}`);
		return;
	}
	if (routeCollection.value) {
		await router.push(`/c/${encodeURIComponent(routeCollection.value)}`);
		return;
	}
	await router.push("/");
}

function buildAttachmentSnippet(file: File, attachmentPath: string): string {
	const name = attachmentPath.split("/").pop() ?? file.name;
	if (file.type.startsWith("image/")) {
		return `![${name}](${name})`;
	}
	return `[${name}](${name})`;
}

async function attachFile(payload: { file: File; from: number }): Promise<void> {
	if (!selectedDoc.value) return;
	if (selectedDoc.value.id.startsWith("draft:")) {
		errorMessage.value = "Attachments are only available after the draft is saved.";
		return;
	}
	uploadingAttachment.value = true;
	errorMessage.value = "";
	try {
		const form = new FormData();
		form.set("file", payload.file);
		form.set("reference", "false");
		const resp = await fetch(
			`/api/documents/${encodeURIComponent(selectedDoc.value.id)}/attachments`,
			{
				method: "POST",
				body: form,
			},
		);
		if (!resp.ok) {
			const body = (await resp.json().catch(() => ({}))) as { error?: string };
			throw new Error(body.error || `HTTP ${resp.status}`);
		}
		const uploaded = (await resp.json()) as { path?: string };
		const path = uploaded.path ?? payload.file.name;
		const snippet = buildAttachmentSnippet(payload.file, path);
		const cursor = Math.max(0, Math.min(payload.from, contentValue.value.length));
		const before = contentValue.value.slice(0, cursor);
		const after = contentValue.value.slice(cursor);
		const prefix = before.endsWith("\n") || before.length === 0 ? "" : "\n";
		const suffix = after.startsWith("\n") || after.length === 0 ? "" : "\n";
		contentValue.value = `${before}${prefix}${snippet}${suffix}${after}`;
		statusMessage.value = uploaded.path ? `Attached ${uploaded.path}` : "Attachment uploaded.";
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : String(error);
	} finally {
		uploadingAttachment.value = false;
	}
}

function updateField(name: string, value: string): void {
	fieldValues[name] = value;
}

watch(
	() => route.fullPath,
	() => {
		refresh().catch((error: unknown) => {
			errorMessage.value = error instanceof Error ? error.message : String(error);
		});
	},
	{ immediate: true },
);
</script>

<template>
	<AppShell :route-kind="routeInfo.kind" :workspace-open="workspaceOpen">
		<template #nav>
			<LeftRail :route-info="routeInfo" :route-collection="routeCollection" :collections="collections" />
		</template>
		<template #list>
			<DocumentListPane
				:route-info="routeInfo"
				:route-collection="routeCollection"
				:query="query"
				:docs="docs"
				:issues="issues"
				:list-empty-label="listEmptyLabel"
				:selected-index="selectedIndex"
				:selected-doc-id="selectedDoc?.id ?? ''"
				@update:query="(value) => (query = value)"
				@search="runSearch"
				@create="createDocument"
				@open="openDoc"
			/>
		</template>
		<template #workspace>
			<WorkspacePane
				:error-message="errorMessage"
				:selected-doc="selectedDoc"
				:check-summary="checkSummary"
				:status-message="statusMessage"
				:saving="saving"
				:mode="mode"
				:mode-options="modeOptions"
				:schema-fields="schemaFields"
				:field-errors="fieldErrors"
				:field-values="fieldValues"
				:content-value="contentValue"
				:link-suggestions="docs"
				:save-disabled="saving || hasFieldErrors"
				:uploading-attachment="uploadingAttachment"
				@update:mode="(value) => (mode = value)"
				@update:content-value="(value) => (contentValue = value)"
				@update:field="updateField"
				@save="saveDocument"
				@check="checkCollection"
				@delete="deleteDocument"
				@back="backToBrowse"
				@attach="attachFile"
			/>
		</template>
	</AppShell>
</template>
