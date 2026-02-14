const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
	testDir: "./tests/e2e",
	testMatch: "**/*.spec.js",
	timeout: 60000,
	expect: {
		timeout: 5000,
	},
	use: {
		headless: true,
	},
	workers: 1,
});
