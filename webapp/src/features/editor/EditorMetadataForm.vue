<script setup lang="ts">
import type { UiSchemaField } from "./schema-form-model";

defineProps<{
	fields: UiSchemaField[];
	values: Record<string, string>;
	errors: Record<string, string>;
}>();

const _emit = defineEmits<{
	"update:field": [name: string, value: string];
}>();
</script>

<template>
	<div class="field-grid">
		<SchemaFieldInput
			v-for="field in fields"
			:key="field.name"
			:field="field"
			:model-value="values[field.name] ?? ''"
			:error="errors[field.name]"
			@update:model-value="(value) => emit('update:field', field.name, value)"
		/>
	</div>
</template>
