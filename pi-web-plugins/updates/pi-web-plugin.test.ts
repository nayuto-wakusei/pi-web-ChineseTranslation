import { afterEach, describe, expect, it, vi } from "vitest";
import { html, svg } from "lit";
import type { PiWebStatusResponse, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import plugin from "./pi-web-plugin";

describe("updates plugin Chinese display text", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes a Chinese panel title", () => {
    const activation = plugin.activate({ apiVersion: 1, pluginId: "updates", html, svg });

    expect(plugin.name).toBe("更新");
    expect(activation.contributions.workspacePanels?.[0]?.title).toBe("更新");
  });

  it("renders Chinese loading and status copy", () => {
    const activation = plugin.activate({ apiVersion: 1, pluginId: "updates", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];

    expect(serializeTemplate(panel?.render(context()))).toContain("正在检查 PI WEB 更新状态");
    expect(serializeTemplate(panel?.badge?.(context()))).toBe("测试版");

    const rendered = serializeTemplate(panel?.render(context({
      state: {
        piWebStatus: {
          packageName: "@chainingintention/pi-web-cn",
          generatedAt: "2026-06-05T00:00:00.000Z",
          messages: [{ id: "restart", severity: "warning", title: "需要重启", body: "服务版本不一致。" }],
          release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: false, skipped: true },
          commands: {
            update: "npm i -g @chainingintention/pi-web-cn",
            restart: "systemctl --user restart pi-web-ui-dev.service",
            restartWeb: "",
            restartSessiond: "",
            status: "systemctl --user status pi-web-ui-dev.service",
          },
          components: {
            web: { component: "web", label: "Web", stale: false, available: true, runtimeVersion: "1", installedVersion: "1", installation: { kind: "local", path: "/tmp/pi-web" } },
            sessiond: { component: "sessiond", label: "Session daemon", stale: true, available: true, runtimeVersion: "1", installedVersion: "2", installation: { kind: "npm-global" } },
          },
        },
      },
    })));

    expect(rendered).toContain("警告");
    expect(rendered).toContain("测试版");
    expect(rendered).toContain("已安装服务");
    expect(rendered).toContain("会话守护进程");
    expect(rendered).toContain("建议命令");
    expect(rendered).toContain("复制");
    expect(rendered).toContain("当前版本");
    expect(rendered).toContain("需要重启");
    expect(rendered).toContain("远程版本检查已跳过。");
  });

  it("keeps run buttons available in management embed mode", () => {
    vi.stubGlobal("location", { search: "?embed=management&token=launch-token" });
    const activation = plugin.activate({ apiVersion: 1, pluginId: "updates", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];

    const rendered = serializeTemplate(panel?.render(context({
      state: {
        piWebStatus: statusWithCommands(),
      },
    })));

    expect(rendered).toContain("复制");
    expect(rendered).toContain("class=\"primary\"");
  });

  it("does not throw when the clipboard API is unavailable", () => {
    vi.stubGlobal("navigator", {});
    const activation = plugin.activate({ apiVersion: 1, pluginId: "updates", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];
    const panelContext = context({ state: { piWebStatus: statusWithCommands() } });
    Reflect.set(panelContext, "terminal", undefined);
    const rendered = panel?.render(panelContext);
    const handlers = templateValues(rendered).filter((value): value is () => void => typeof value === "function");

    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) {
      expect(() => { handler(); }).not.toThrow();
    }
  });
});

function context(patch: Partial<WorkspacePanelContext> = {}): WorkspacePanelContext {
  return {
    machine: { id: "local", name: "local", kind: "local" },
    workspace: { id: "w1", projectId: "p1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false },
    files: { readFile: () => Promise.reject(new Error("unused")) },
    terminal: { open: () => undefined, runCommand: () => Promise.reject(new Error("unused")) },
    host: { requestRender: () => undefined },
    ...patch,
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

function templateValues(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(templateValues);
  if (typeof value === "object" && "strings" in value && "values" in value) {
    const values = Reflect.get(value, "values");
    if (isUnknownArray(values)) return values.flatMap((entry) => [entry, ...templateValues(entry)]);
  }
  return [];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function statusWithCommands(): PiWebStatusResponse {
  return {
    packageName: "@chainingintention/pi-web-cn",
    generatedAt: "2026-06-05T00:00:00.000Z",
    messages: [],
    release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: false, skipped: true },
    commands: {
      update: "npm i -g @chainingintention/pi-web-cn",
      restart: "systemctl --user restart pi-web-ui-dev.service",
      restartWeb: "",
      restartSessiond: "",
      status: "systemctl --user status pi-web-ui-dev.service",
    },
    components: {
      web: { component: "web", label: "Web", stale: false, available: true, runtimeVersion: "1", installedVersion: "1", installation: { kind: "local", path: "/tmp/pi-web" } },
      sessiond: { component: "sessiond", label: "Session daemon", stale: true, available: true, runtimeVersion: "1", installedVersion: "2", installation: { kind: "npm-global" } },
    },
  };
}
