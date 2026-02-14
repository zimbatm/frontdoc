import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vue()],
	root: resolve(import.meta.dirname),
	base: "/ui/",
	build: {
		emptyOutDir: true,
		outDir: resolve(import.meta.dirname, "../src/web/static"),
		cssCodeSplit: false,
		rollupOptions: {
			output: {
				entryFileNames: "main.js",
				chunkFileNames: "chunk-[name].js",
				assetFileNames: (assetInfo) => {
					if (assetInfo.name?.endsWith(".css")) {
						return "main.css";
					}
					return "asset-[name][extname]";
				},
			},
		},
	},
});
