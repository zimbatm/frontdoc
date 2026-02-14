<script setup lang="ts">
import { computed } from "vue";
import type { RouteKind } from "../../web-ui-model";

const props = defineProps<{
	routeKind: RouteKind;
	workspaceOpen: boolean;
}>();

const _shellClass = computed(() => ({
	"workspace-open": props.workspaceOpen,
	"workspace-closed": !props.workspaceOpen,
	"validation-focus": props.routeKind === "validation",
}));
</script>

<template>
	<div class="page" :class="shellClass" data-testid="app-shell">
		<section class="pane pane-nav" data-pane="nav" data-testid="nav-pane">
			<slot name="nav" />
		</section>
		<section class="pane pane-list" data-pane="list" data-testid="list-pane">
			<slot name="list" />
		</section>
		<section class="pane pane-workspace" data-pane="workspace" data-testid="workspace-pane">
			<slot name="workspace" />
		</section>
	</div>
</template>
