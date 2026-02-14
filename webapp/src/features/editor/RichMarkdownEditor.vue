<script setup lang="ts">
import {
	autocompletion,
	type CompletionContext,
	type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
	drawSelection,
	dropCursor,
	EditorView,
	keymap,
	lineNumbers,
	placeholder,
} from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ListDoc } from "../types";

const props = defineProps<{
	modelValue: string;
	suggestions: ListDoc[];
	placeholder?: string;
	readOnly?: boolean;
	autofocus?: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: string];
	"cursor-change": [pos: number];
	attach: [payload: { file: File; from: number }];
}>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const readOnlyCompartment = new Compartment();

function wikiCompletion(context: CompletionContext): CompletionResult | null {
	const cursor = context.pos;
	const textBefore = context.state.sliceDoc(Math.max(0, cursor - 160), cursor);
	const match = /\[\[([^\]\n]{0,120})$/.exec(textBefore);
	if (!match) return null;

	const query = match[1]?.toLowerCase() ?? "";
	const from = cursor - match[0].length;
	const options = props.suggestions
		.filter((doc) => {
			if (query.length === 0) return true;
			return (
				doc.title.toLowerCase().includes(query) ||
				doc.path.toLowerCase().includes(query) ||
				doc.id.toLowerCase().includes(query) ||
				(doc.shortId ?? "").toLowerCase().includes(query)
			);
		})
		.slice(0, 12)
		.map((doc) => {
			const token = doc.shortId && doc.shortId.length > 0 ? doc.shortId : doc.id;
			return {
				label: doc.title,
				detail: doc.path,
				type: "text",
				apply: `[[${token}:${doc.title}]]`,
			};
		});

	if (options.length === 0) {
		return null;
	}
	return { from, options };
}

function currentCursor(): number {
	return view?.state.selection.main.head ?? 0;
}

function findFirstFile(files?: FileList | null): File | null {
	if (!files || files.length === 0) return null;
	return files.item(0);
}

onMounted(() => {
	if (!host.value) return;
	view = new EditorView({
		parent: host.value,
		state: EditorState.create({
			doc: props.modelValue,
			extensions: [
				lineNumbers(),
				drawSelection(),
				dropCursor(),
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				markdown({
					base: markdownLanguage,
				}),
				autocompletion({
					override: [wikiCompletion],
				}),
				placeholder(props.placeholder ?? "Write markdown..."),
				EditorView.lineWrapping,
				EditorView.domEventHandlers({
					drop: (event, cmView) => {
						const file = findFirstFile(event.dataTransfer?.files);
						if (!file) return;
						event.preventDefault();
						const pos =
							cmView.posAtCoords({ x: event.clientX, y: event.clientY }) ??
							cmView.state.selection.main.head;
						emit("attach", { file, from: pos });
					},
					paste: (event, cmView) => {
						const file = findFirstFile(event.clipboardData?.files);
						if (!file) return;
						event.preventDefault();
						emit("attach", { file, from: cmView.state.selection.main.head });
					},
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						emit("update:modelValue", update.state.doc.toString());
					}
					if (update.selectionSet) {
						emit("cursor-change", update.state.selection.main.head);
					}
				}),
				readOnlyCompartment.of(EditorView.editable.of(!props.readOnly)),
			],
		}),
	});
	emit("cursor-change", currentCursor());
	if (props.autofocus !== false && !props.readOnly) {
		requestAnimationFrame(() => {
			view?.focus();
		});
	}
});

watch(
	() => props.modelValue,
	(next) => {
		if (!view) return;
		const current = view.state.doc.toString();
		if (current === next) return;
		const cursor = view.state.selection.main.head;
		view.dispatch({
			changes: { from: 0, to: current.length, insert: next },
			selection: EditorSelection.cursor(Math.min(cursor, next.length)),
		});
	},
);

watch(
	() => props.readOnly,
	(readOnly) => {
		if (!view) return;
		view.dispatch({
			effects: readOnlyCompartment.reconfigure(EditorView.editable.of(!readOnly)),
		});
	},
);

onBeforeUnmount(() => {
	view?.destroy();
	view = null;
});
</script>

<template>
	<div ref="host" class="rich-editor-host" />
</template>
