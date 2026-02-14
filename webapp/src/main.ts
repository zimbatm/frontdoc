import Aura from "@primeuix/themes/aura";
import PrimeVue from "primevue/config";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "primeicons/primeicons.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./style.css";

const app = createApp(App);

app.use(router);
app.use(PrimeVue, {
	theme: {
		preset: Aura,
		options: {
			darkModeSelector: false,
		},
	},
});

app.mount("#app");
