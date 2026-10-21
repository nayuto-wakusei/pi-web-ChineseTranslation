// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { html } from "lit";
import type { ContentRendererContribution } from "../../../plugin-api";
import { PluginRegistry } from "./registry";
import { availableMessageActions } from "./messageActions";
import type { PluginContributions } from "./types";

it.each(["stylesheets", "syntaxHighlighters"])("rejects v5-only contribution fields on v4: %s", async (field) => {
  const registry = new PluginRegistry();
  const contributions: PluginContributions = {};
  Reflect.set(contributions, field, []);
  try {
    await expect(registry.register({ id: "legacy", plugin: { apiVersion: 4, name: "Legacy", activate: () => ({ contributions }) } })).rejects.toThrow("require browser API v5");
    expect(registry.hasPlugin("legacy")).toBe(false);
  } finally { await registry.dispose(); }
});
  it("exposes question metadata only to v5 entry-action callbacks", async () => {
    const registry = new PluginRegistry();
    const legacyVisible = vi.fn(() => true);
    const modernVisible = vi.fn(() => true);
    try {
      for (const apiVersion of [4, 5] as const) {
        await registry.register({ id: `v${String(apiVersion)}`, plugin: { apiVersion, name: "Messages", activate: () => ({ contributions: {
          messageActions: [{ id: "action", title: "Action", visible: apiVersion === 4 ? legacyVisible : modernVisible, run: () => undefined }],
        } }) } });
      }
      const context = {
        machine: { id: "local", name: "Local", kind: "local" as const },
        session: { id: "session", cwd: "/repo", archived: false, pending: false, busy: false },
        message: { entryId: "question", role: "tool" as const, text: "", isQuestion: true },
      };
      availableMessageActions(registry.getMessageActions("local"), context);
      expect(legacyVisible).toHaveBeenCalledWith({ ...context, message: { entryId: "question", role: "tool", text: "" } });
      expect(modernVisible).toHaveBeenCalledWith(context);
    } finally { await registry.dispose(); }
  });

  it("keeps v4 renderer inputs at their released shape", async () => {
    const render = vi.fn<ContentRendererContribution["render"]>(() => html``);
    const registry = new PluginRegistry();
    try {
      await registry.register({ id: "legacy", plugin: { apiVersion: 4, name: "Legacy", activate: () => ({ contributions: {
        contentRenderers: [{ id: "preview", languages: ["test"], render }],
      } }) } });
      const input = { text: "source", signal: new AbortController().signal, fail: vi.fn(), machineId: "local", language: "test", filePath: "source.test" };
      registry.matchContentRenderers({ machineId: "local", language: "test", text: "source" })[0]?.renderer.render(input);
      expect(Object.keys(render.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["fail", "signal", "text"]);
    } finally { await registry.dispose(); }
  });
