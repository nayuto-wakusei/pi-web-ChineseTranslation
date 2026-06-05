import { describe, expect, it } from "vitest";
import { html, svg } from "lit";
import type { WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import plugin from "./pi-web-plugin";

describe("info plugin Chinese display text", () => {
  it("exposes Chinese action and panel labels", () => {
    const activation = plugin.activate({ apiVersion: 1, pluginId: "info", html, svg });

    expect(plugin.name).toBe("信息插件");
    expect(activation.contributions.actions?.[0]).toMatchObject({
      title: "显示当前工作区路径",
      group: "信息",
    });
    expect(activation.contributions.workspaceLabels?.[0]?.items(context({ isGitRepo: false }))[0]).toMatchObject({ text: "文件夹" });
    expect(activation.contributions.workspacePanels?.[0]?.title).toBe("信息");
  });

  it("renders Chinese workspace copy", () => {
    const activation = plugin.activate({ apiVersion: 1, pluginId: "info", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];

    const rendered = serializeTemplate(panel?.render(context()));
    expect(rendered).toContain("<strong>信息</strong>");
    expect(rendered).toContain("<p><strong>工作区</strong></p>");
  });
});

function context(patch: { isGitRepo?: boolean } = {}): WorkspacePanelContext {
  return {
    machine: { id: "local", name: "local", kind: "local" },
    workspace: {
      id: "w1",
      projectId: "p1",
      path: "/tmp/project",
      label: "main",
      isMain: true,
      isGitRepo: patch.isGitRepo ?? true,
      isGitWorktree: false,
    },
    files: { readFile: () => Promise.reject(new Error("unused")) },
    terminal: { open: () => undefined, runCommand: () => Promise.reject(new Error("unused")) },
    host: { requestRender: () => undefined },
  };
}

function serializeTemplate(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(serializeTemplate).join("");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);

  if (typeof value === "object" && "strings" in value && "values" in value) {
    const strings = value.strings;
    const values = value.values;
    if (isStringArray(strings) && isUnknownArray(values)) {
      return strings.reduce((output: string, part: string, index: number) => `${output}${part}${serializeTemplate(values[index])}`, "");
    }
  }
  return "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
