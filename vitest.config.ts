import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const allTests = ["src/**/*.test.ts", "pi-web-plugins/**/*.test.ts", "pi-packages/**/*.test.ts", "scripts/**/*.test.mjs"];
const piSessionServiceTests = ["src/server/sessions/piSessionService*.test.ts"];

export default defineConfig({
  resolve: {
    alias: { "@chainingintention/pi-web-cn/server-plugin-api": fileURLToPath(new URL("./src/server-plugin-api.ts", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "general",
          include: allTests,
          exclude: piSessionServiceTests,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "pi-session-service",
          include: piSessionServiceTests,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
