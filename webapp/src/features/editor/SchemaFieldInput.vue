<script setup lang="ts">
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import type { UiSchemaField } from "./schema-form-model";

const props = defineProps<{
	field: UiSchemaField;
	modelValue: string;
	error?: string;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: string];
}>();

const inputId = `field-${props.field.name}`;
</script>

<template>
	<div>
		<label class="field-label" :for="inputId">
			{{ field.name }}
			<span v-if="field.required" class="field-required">*</span>
		</label>

		<select
			v-if="field.type === 'enum'"
			:id="inputId"
			class="field-native"
			:value="modelValue"
			@change="emit('update:modelValue', String(($event.target as HTMLSelectElement).value))"
		>
			<option value="">Select…</option>
			<option v-for="option in field.enumValues" :key="option" :value="option">{{ option }}</option>
		</select>

		<Textarea
			v-else-if="field.type === 'array'"
			:id="inputId"
			:model-value="modelValue"
			rows="4"
			auto-resize
			placeholder="One value per line or comma-separated"
			@update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
		/>

		<InputText
			v-else-if="field.type === 'number'"
			:id="inputId"
			type="number"
			:model-value="modelValue"
			@update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
		/>

		<InputText
			v-else-if="field.type === 'date'"
			:id="inputId"
			type="date"
			:model-value="modelValue"
			@update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
		/>

		<InputText
			v-else-if="field.type === 'datetime'"
			:id="inputId"
			type="datetime-local"
			:model-value="modelValue"
			@update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
		/>

		<InputText
			v-else-if="field.type === 'email'"
			:id="inputId"
			type="email"
			:model-value="modelValue"
			@update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
		/>

		<InputText
			v-else
			:id="inputId"
			:model-value="modelValue"
			@update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
		/>

		<div v-if="field.description" class="field-help">{{ field.description }}</div>
		<div v-if="error" class="field-error">{{ error }}</div>
	</div>
</template>
