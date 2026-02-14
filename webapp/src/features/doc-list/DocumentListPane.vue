<script setup lang="ts">
import type { ParsedRoute } from "../../web-ui-model";
import type { ListDoc, ValidationIssue } from "../types";

const props = defineProps<{
	routeInfo: ParsedRoute;
	routeCollection: string;
	query: string;
	docs: ListDoc[];
	issues: ValidationIssue[];
	listEmptyLabel: string;
	selectedIndex: number;
	selectedDocId: string;
}>();

const _emit = defineEmits<{
	"update:query": [value: string];
	search: [];
	create: [];
	open: [doc: ListDoc, index: number];
}>();

function _prettyDate(value: string): string {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

function _issueClass(issue: ValidationIssue): string {
	return issue.severity === "error" ? "issue error" : "issue";
}

function _isDocActive(doc: ListDoc, index: number): boolean {
	if (props.selectedDocId.length > 0 && props.selectedDocId === doc.id) return true;
	return index === props.selectedIndex;
}
</script>

<template>
	<Card class="document-list-card">
		<template #content>
			<div class="search-row">
				<span class="search-icon pi pi-search" aria-hidden="true" />
				<InputText
					:model-value="query"
					placeholder="Search by text or filter"
					@update:model-value="(v) => emit('update:query', String(v ?? ''))"
					@keydown.enter="emit('search')"
				/>
				<Button icon="pi pi-search" severity="secondary" text @click="emit('search')" />
				<Button label="New" icon="pi pi-plus" @click="emit('create')" />
			</div>
			<div v-if="routeInfo.kind === 'validation'" class="doc-list" data-testid="doc-list">
				<div v-if="issues.length === 0" class="list-empty">{{ listEmptyLabel }}</div>
				<div v-for="(issue, idx) in issues" :key="idx" :class="issueClass(issue)">
					<div><strong>{{ issue.path || "unknown" }}</strong></div>
					<div>{{ issue.message || "validation issue" }}</div>
				</div>
			</div>
			<div v-else class="doc-list" data-testid="doc-list">
				<div v-if="docs.length === 0" class="list-empty">{{ listEmptyLabel }}</div>
				<div
					v-for="(doc, idx) in docs"
					:key="doc.id"
					class="doc-item"
					:class="{ active: isDocActive(doc, idx) }"
					@click="emit('open', doc, idx)"
				>
					<div class="doc-item-head">
						<div class="doc-title">{{ doc.title }}</div>
					</div>
					<div class="doc-meta">{{ doc.path }}</div>
					<div class="doc-updated">Updated {{ prettyDate(doc.updatedAt) }}</div>
				</div>
			</div>
		</template>
	</Card>
</template>
