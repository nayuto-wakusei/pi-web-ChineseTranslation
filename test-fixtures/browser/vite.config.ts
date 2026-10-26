import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Exercise built components without a daemon, user config, HMR, or dev-server
// dependency optimization. Keep test output separate from the published app.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("../../node_modules/.cache/pi-web/browser-fixture", import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        managementShell: fileURLToPath(new URL("management-shell.html", import.meta.url)),
        navigation: fileURLToPath(new URL("navigation.html", import.meta.url)),
        customUi: fileURLToPath(new URL("custom-ui.html", import.meta.url)),
        overlays: fileURLToPath(new URL("overlays.html", import.meta.url)),
        chat: fileURLToPath(new URL("chat.html", import.meta.url)),
        composer: fileURLToPath(new URL("composer.html", import.meta.url)),
        settings: fileURLToPath(new URL("settings.html", import.meta.url)),
      },
    },
  },
});
