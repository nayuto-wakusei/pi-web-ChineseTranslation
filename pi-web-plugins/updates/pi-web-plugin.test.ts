import { afterEach, describe, expect, it, vi } from "vitest";
import { html, svg } from "lit";
import type { PiWebStatusResponse, PluginRuntimeContext } from "@chainingintention/pi-web-cn/plugin-api";
import { createWorkspacePanelContext, serializeTemplate } from "../../src/testSupport/plugin";
import plugin from "./pi-web-plugin";

describe("updates plugin Chinese display text", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes a Chinese panel title", () => {
    const activation = plugin.activate({ apiVersion: 2, pluginId: "updates", html, svg });

    expect(plugin.name).toBe("更新");
    expect(activation.contributions.workspacePanels?.[0]?.title).toBe("更新");
  });

  it("renders Chinese loading and status copy", () => {
    const activation = plugin.activate({ apiVersion: 2, pluginId: "updates", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];

    expect(serializeTemplate(panel?.render(createWorkspacePanelContext()))).toContain("正在检查 PI WEB 更新状态");
    expect(serializeTemplate(panel?.badge?.(createWorkspacePanelContext()))).toBe("");

    const rendered = serializeTemplate(panel?.render(createWorkspacePanelContext({
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
    expect(rendered).not.toContain("测试版");
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
    const activation = plugin.activate({ apiVersion: 2, pluginId: "updates", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];

    const rendered = serializeTemplate(panel?.render(createWorkspacePanelContext({
      state: {
        piWebStatus: statusWithCommands(),
      },
    })));

    expect(rendered).toContain("复制");
    expect(rendered).toContain("class=\"primary\"");
  });

  it("does not throw when the clipboard API is unavailable", () => {
    vi.stubGlobal("navigator", {});
    const activation = plugin.activate({ apiVersion: 2, pluginId: "updates", html, svg });
    const panel = activation.contributions.workspacePanels?.[0];
    const panelContext = createWorkspacePanelContext({ state: { piWebStatus: statusWithCommands() } });
    Reflect.set(panelContext, "terminal", undefined);
    const rendered = panel?.render(panelContext);
    const handler = copyButtonHandler(rendered);

    expect(() => { handler(); }).not.toThrow();
  });
});

describe("updates plugin actions", () => {
  it("forces an update check through the host runtime context", async () => {
    const action = plugin.activate({ apiVersion: 2, pluginId: "updates", html, svg }).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const checkForPiWebUpdates = vi.fn(() => Promise.resolve());
    const context = runtimeContext({ checkForPiWebUpdates });

    expect(action.title).toBe("检查 PI WEB 更新");
    expect(action.enabled?.(context)).toBe(true);
    await action.run(context);

    expect(checkForPiWebUpdates).toHaveBeenCalledOnce();
  });

  it("disables the action on older hosts without the update-check helper", () => {
    const action = plugin.activate({ apiVersion: 2, pluginId: "updates", html, svg }).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const context = runtimeContext();

    expect(action.enabled?.(context)).toBe(false);
    expect(action.disabledReason?.(context)).toContain("较新版本的 PI WEB 网关");
  });
});

type CopyButtonHandler = (event?: Event) => void;

// This node-only plugin test would need a full plugin-host DOM harness just to verify one click binding.
// Anchor the narrow escape hatch to the stable visible "复制" label instead of invoking every template function.
function copyButtonHandler(value: unknown): CopyButtonHandler {
  const handler = findCopyButtonHandler(value);
  if (handler === undefined) throw new Error("Expected a 复制 button handler");
  return handler;
}
function findCopyButtonHandler(value: unknown): CopyButtonHandler | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const handler = findCopyButtonHandler(entry);
      if (handler !== undefined) return handler;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;

  const strings: unknown = Reflect.get(value, "strings");
  const values: unknown = Reflect.get(value, "values");
  if (!isUnknownArray(strings) || !isUnknownArray(values)) return undefined;
  for (let index = 0; index < values.length; index += 1) {
    const candidate = values[index];
    const before: unknown = strings[index];
    const after: unknown = strings[index + 1];
    if (typeof candidate === "function" && typeof before === "string" && before.includes("@click=") && typeof after === "string" && after.includes(">复制</button>")) {
      return (event?: Event) => { Reflect.apply(candidate, undefined, [event]); };
    }
    const nested = findCopyButtonHandler(candidate);
    if (nested !== undefined) return nested;
  }
  return undefined;
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
function runtimeContext(patch: Partial<PluginRuntimeContext> = {}): PluginRuntimeContext {
  const noop = () => undefined;
  return {
    state: {},
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    openActionPalette: noop,
    focusPrompt: noop,
    addProject: noop,
    configureAuth: noop,
    logoutAuth: noop,
    openThemePicker: noop,
    selectMainView: noop,
    selectWorkspaceTool: noop,
    openTerminal: noop,
    refreshFiles: noop,
    refreshGit: noop,
    refreshAppData: noop,
    reloadPage: noop,
    startSession: noop,
    archiveSession: noop,
    stopActiveWork: noop,
    ...patch,
  };
}
