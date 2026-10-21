import { vi } from "vitest";

// Node-only shell wiring tests have no browser asset URL boundary. Real theme
// registration and CSS files are covered by plugins/themes/index.test.ts.
vi.mock("../plugins/themes", () => ({
  themePackPlugin: { apiVersion: 5, name: "Test themes", activate: () => ({ contributions: { themes: [] } }) },
}));
