// @vitest-environment happy-dom
import { html, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import relays from "../pi-packages/relays/pi-web-plugin.js";
import tasks from "./workspace-tasks/pi-web-plugin.js";
import { runtimeContext } from "../src/client/src/plugins/pluginRuntime.testSupport.js";

afterEach(() => { document.body.replaceChildren(); });

it.each([
  [tasks, "workspace-tasks", "workspace.tasks"],
  [relays, "relays", "workspace.relays"],
] as const)("opens its machine-scoped runtime panel rather than the source plugin panel", async (plugin, pluginId, panelId) => {
  const signal = new AbortController().signal;
  const runtimePluginId = `remote-1.${pluginId}`;
  const activation = await plugin.activate({ apiVersion: 4, pluginId, runtimePluginId, html, svg, signal, lifetimeSignal: signal });
  const action = activation.contributions.actions?.[0];
  expect(action).toBeDefined();
  const selectWorkspaceTool = vi.fn();
  await action?.run(runtimeContext({
    state: { selectedWorkspace: { id: "w", projectId: "p", path: "/workspace", label: "main", isMain: true } },
    selectWorkspaceTool,
  }));
  expect(selectWorkspaceTool).toHaveBeenCalledWith(`${runtimePluginId}:${panelId}`);
});
