import { createRouter, createWebHistory } from "vue-router";

const RouteShell = { template: "<div />" };

export const router = createRouter({
	history: createWebHistory(),
	routes: [
		{ path: "/", name: "all", component: RouteShell },
		{ path: "/recent", name: "recent", component: RouteShell },
		{ path: "/validation", name: "validation", component: RouteShell },
		{ path: "/c/:collection", name: "collection", component: RouteShell },
		{ path: "/c/:collection/:docKey(.*)", name: "doc", component: RouteShell },
	],
});
