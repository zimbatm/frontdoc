import Aura from "@primeuix/themes/aura";
import { flushPromises, mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "../../src/App.vue";

describe("web app shell", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test("renders collections and document list from API", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/api/collections")) {
				return new Response(JSON.stringify({ collections: [{ name: "clients", count: 1 }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/api/documents")) {
				return new Response(
					JSON.stringify({
						documents: [
							{
								id: "01TESTID",
								collection: "clients",
								path: "clients/acme-01TESTID.md",
								title: "Acme",
								updatedAt: "2026-02-14T00:00:00.000Z",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes("/api/check")) {
				return new Response(JSON.stringify({ scanned: 0, issues: [] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const router = createRouter({
			history: createMemoryHistory(),
			routes: [
				{ path: "/", component: { template: "<div />" } },
				{ path: "/recent", component: { template: "<div />" } },
				{ path: "/validation", component: { template: "<div />" } },
				{ path: "/c/:collection", component: { template: "<div />" } },
				{ path: "/c/:collection/:docKey(.*)", component: { template: "<div />" } },
			],
		});
		await router.push("/");
		await router.isReady();

		const wrapper = mount(App, {
			global: {
				plugins: [
					router,
					[
						PrimeVue,
						{
							theme: {
								preset: Aura,
								options: {
									darkModeSelector: false,
								},
							},
						},
					],
				],
			},
		});

		await flushPromises();

		expect(wrapper.get("[data-testid='app-shell']").exists()).toBe(true);
		expect(wrapper.get("[data-testid='nav-pane']").exists()).toBe(true);
		expect(wrapper.get("[data-testid='list-pane']").exists()).toBe(true);
		expect(wrapper.get("[data-testid='workspace-pane']").exists()).toBe(true);
		expect(wrapper.get("[data-testid='nav-pane']").text()).toContain("clients");
		expect(wrapper.get("[data-testid='doc-list']").text()).toContain("Acme");
	});
});
