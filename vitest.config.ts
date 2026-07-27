import { defineConfig } from "vitest/config";

const allTests = ["src/**/*.test.ts", "pi-web-plugins/**/*.test.ts", "scripts/**/*.test.mjs"];
const piSessionServiceTests = ["src/server/sessions/piSessionService*.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "general",
          include: allTests,
          exclude: piSessionServiceTests,
          sequence: { groupOrder: 0 },
        },
      },
      {
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
