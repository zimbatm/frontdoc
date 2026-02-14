<script setup lang="ts">
import Card from "primevue/card";
import Tag from "primevue/tag";
import type { ParsedRoute } from "../../web-ui-model";
import type { CollectionInfo } from "../types";

defineProps<{
	routeInfo: ParsedRoute;
	routeCollection: string;
	collections: CollectionInfo[];
}>();
</script>

<template>
	<Card class="left-rail-card">
		<template #content>
			<nav class="nav-list" aria-label="Primary navigation">
				<RouterLink class="nav-link" :class="{ active: routeInfo.kind === 'all' }" to="/">
					<span class="nav-link-main">
						<i class="pi pi-list" aria-hidden="true" />
						<span>All Documents</span>
					</span>
				</RouterLink>
				<RouterLink class="nav-link" :class="{ active: routeInfo.kind === 'recent' }" to="/recent">
					<span class="nav-link-main">
						<i class="pi pi-clock" aria-hidden="true" />
						<span>Recent</span>
					</span>
				</RouterLink>
				<RouterLink
					class="nav-link"
					:class="{ active: routeInfo.kind === 'validation' }"
					to="/validation"
				>
					<span class="nav-link-main">
						<i class="pi pi-check-circle" aria-hidden="true" />
						<span>Validation</span>
					</span>
				</RouterLink>
				<RouterLink
					v-for="collection in collections"
					:key="collection.name"
					class="nav-link"
					:class="{ active: routeCollection === collection.name }"
					:to="`/c/${encodeURIComponent(collection.name)}`"
				>
					<span class="nav-link-main">
						<i class="pi pi-folder" aria-hidden="true" />
						<span>{{ collection.name }}</span>
					</span>
					<Tag :value="String(collection.count)" severity="contrast" />
				</RouterLink>
			</nav>
		</template>
	</Card>
</template>
