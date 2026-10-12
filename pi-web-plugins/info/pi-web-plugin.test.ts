import { html, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeContext } from "../../src/client/src/plugins/pluginRuntime.testSupport.js";
import plugin from "./pi-web-plugin.js";

describe("Info plugin copy-diagnostics action", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies a diagnostics summary to the clipboard", async () => {
    const writeText = vi.fn((text: string) => { void text; return Promise.resolve(); });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const action = await findCopyDiagnosticsAction();
    const context = runtimeContext({
      state: {
        selectedMachine: { id: "local", name: "devbox", kind: "local" },
        selectedWorkspace: {
          id: "ws-1",
          projectId: "proj-1",
          path: "/srv/dev/pi-web",
          label: "pi-web",
          isMain: true,
          provider: {
            pluginId: "git",
            capabilities: { remove: true },
            metadata: { branch: "main" },
          },
        },
      },
    });

    await action.run(context);

    expect(writeText).toHaveBeenCalledOnce();
    const summary = writeText.mock.calls[0]?.[0];
    expect(summary).toBe([
      "PI WEB 诊断信息",
      "状态：不可用",
      "机器：devbox（本地机器）",
      "工作区：pi-web - /srv/dev/pi-web（提供器 git、主工作区）",
    ].join("\n"));
  });
});

async function findCopyDiagnosticsAction() {
  const signal = new AbortController().signal;
  const activation = await plugin.activate({ apiVersion: 4, pluginId: "info", runtimePluginId: "info", html, svg, signal, lifetimeSignal: signal });
  const action = activation.contributions.actions?.find((candidate) => candidate.id === "copy-diagnostics");
  if (action === undefined) throw new Error("Expected copy-diagnostics action");
  return action;
}
