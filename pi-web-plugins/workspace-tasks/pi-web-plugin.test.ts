import { describe, expect, it, vi } from "vitest";
import { html, svg } from "lit";

describe("workspace tasks plugin Chinese display text", () => {
  it("exposes Chinese action and panel labels", async () => {
    vi.stubGlobal("HTMLElement", function HTMLElementStub(): undefined { return undefined; });
    vi.stubGlobal("customElements", { get: () => undefined, define: vi.fn() });

    const { default: plugin } = await import("./pi-web-plugin");
    const activation = plugin.activate({ apiVersion: 2, pluginId: "workspace-tasks", html, svg });

    expect(plugin.name).toBe("工作区任务");
    expect(activation.contributions.actions?.[0]).toMatchObject({
      title: "打开工作区任务",
      description: "打开工作区任务标签页。在 .pi-web/tasks.json 中配置任务。",
      group: "工作区",
    });
    expect(activation.contributions.workspacePanels?.[0]?.title).toBe("任务");
  });
});
