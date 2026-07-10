import { describe, expect, it } from "vitest";
import { html, svg } from "lit";
import { createWorkspacePanelContext, serializeTemplate } from "../../src/testSupport/plugin";
import plugin from "./pi-web-plugin";

describe("info plugin Chinese display text", () => {
  it("exposes Chinese action and panel labels", () => {
    const activation = plugin.activate({ apiVersion: 1, pluginId: "info", html, svg });

    expect(plugin.name).toBe("信息插件");
    expect(activation.contributions.actions?.[0]).toMatchObject({
      title: "显示当前工作区路径",
      group: "信息",
    });
    const context = createWorkspacePanelContext();
    context.workspace.isGitRepo = false;
    expect(activation.contributions.workspaceLabels?.[0]?.items(context)[0]).toMatchObject({ text: "文件夹" });
    expect(activation.contributions.workspacePanels?.[0]?.title).toBe("信息");
  });

  it("renders Chinese workspace copy", () => {
    const activation = plugin.activate({ apiVersion: 1, pluginId: "info", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];

    const rendered = serializeTemplate(panel?.render(createWorkspacePanelContext()));
    expect(rendered).toContain("<strong>信息</strong>");
    expect(rendered).toContain("<p><strong>工作区</strong></p>");
  });
});
