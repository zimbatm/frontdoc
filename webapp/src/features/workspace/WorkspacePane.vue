<script setup lang="ts">
import MarkdownIt from "markdown-it";
import Button from "primevue/button";
import Card from "primevue/card";
import Message from "primevue/message";
import SelectButton from "primevue/selectbutton";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from "vue";
import EditorMetadataForm from "../editor/EditorMetadataForm.vue";
import type { UiSchemaField } from "../editor/schema-form-model";
import type { EditorMode, ListDoc, ReadDoc } from "../types";

const RichMarkdownEditor = defineAsyncComponent(() => import("../editor/RichMarkdownEditor.vue"));

const props = defineProps<{
	errorMessage: string;
	selectedDoc: ReadDoc | null;
	checkSummary: string;
	statusMessage: string;
	saving: boolean;
	mode: EditorMode;
	modeOptions: Array<{ label: string; value: EditorMode }>;
	schemaFields: UiSchemaField[];
	fieldErrors: Record<string, string>;
	fieldValues: Record<string, string>;
	contentValue: string;
	linkSuggestions: ListDoc[];
	uploadingAttachment: boolean;
	saveDisabled: boolean;
}>();

const emit = defineEmits<{
	"update:mode": [value: EditorMode];
	"update:contentValue": [value: string];
	"update:field": [name: string, value: string];
	save: [];
	check: [];
	delete: [];
	back: [];
	attach: [payload: { file: File; from: number }];
}>();

const markdown = new MarkdownIt({
	html: false,
	linkify: true,
	breaks: true,
});

const previewHtml = computed(() => markdown.render(props.contentValue || ""));

function onGlobalKeydown(event: KeyboardEvent): void {
	if (!props.selectedDoc) return;
	const target = event.target as HTMLElement | null;
	const isEditable =
		target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
	if (isEditable && event.key !== "s" && event.key !== "S") return;
	if (event.metaKey || event.ctrlKey) {
		if (event.key.toLowerCase() === "s") {
			event.preventDefault();
			emit("save");
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			emit("check");
			return;
		}
	}
	if (event.altKey) {
		if (event.key === "1") emit("update:mode", "edit");
		if (event.key === "2") emit("update:mode", "preview");
		if (event.key === "3") emit("update:mode", "split");
	}
}

onMounted(() => {
	window.addEventListener("keydown", onGlobalKeydown);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onGlobalKeydown);
});
</script>

<template>
	<Card>
		<template #content>
			<div class="workspace">
				<div v-if="!selectedDoc" class="workspace-empty">
					<Message v-if="errorMessage" severity="error">{{ errorMessage }}</Message>
					<div>Select a document from the list.</div>
					<div class="status" v-if="checkSummary">{{ checkSummary }}</div>
				</div>
				<template v-else>
					<div class="workspace-head">
						<div>
							<strong>{{ selectedDoc.title }}</strong>
							<div class="status">{{ selectedDoc.path }}</div>
						</div>
						<div class="mode-group">
							<Button
								label="Browse"
								icon="pi pi-arrow-left"
								severity="secondary"
								text
								@click="emit('back')"
							/>
							<SelectButton
								:model-value="mode"
								:options="modeOptions"
								option-label="label"
								option-value="value"
								@update:model-value="(v) => emit('update:mode', v as EditorMode)"
							/>
							<Button
								label="Save"
								icon="pi pi-save"
								:loading="saving"
								:disabled="saveDisabled"
								@click="emit('save')"
							/>
							<Button
								label="Check"
								icon="pi pi-check-square"
								severity="secondary"
								@click="emit('check')"
							/>
							<Button
								label="Delete"
								icon="pi pi-trash"
								severity="danger"
								@click="emit('delete')"
							/>
						</div>
					</div>
					<div class="workspace-body">
						<Message v-if="errorMessage" severity="error">{{ errorMessage }}</Message>
						<EditorMetadataForm
							:fields="schemaFields"
							:values="fieldValues"
							:errors="fieldErrors"
							@update:field="(name, value) => emit('update:field', name, value)"
						/>
						<div class="content-grid editor-zone" :class="{ split: mode === 'split' }">
							<RichMarkdownEditor
								v-if="mode !== 'preview'"
								:key="selectedDoc?.id"
								class="editor-input-wrap"
								:model-value="contentValue"
								:suggestions="linkSuggestions.filter((doc) => doc.id !== selectedDoc?.id)"
								:read-only="uploadingAttachment"
								:autofocus="true"
								@update:model-value="(value) => emit('update:contentValue', value)"
								@attach="(payload) => emit('attach', payload)"
							/>
							<div v-if="mode !== 'edit'" class="preview markdown-preview" v-html="previewHtml" />
						</div>
						<div class="shortcut-help">
							Shortcuts: `Ctrl/Cmd+S` save, `Ctrl/Cmd+Enter` check, `Alt+1/2/3` Edit/Preview/Split.
						</div>
						<div class="status" v-if="Object.keys(fieldErrors).length > 0">
							Fix field errors before saving.
						</div>
						<div class="status" v-if="uploadingAttachment">Uploading attachment…</div>
						<div class="status" v-if="statusMessage">{{ statusMessage }}</div>
					</div>
				</template>
			</div>
		</template>
	</Card>
</template>
