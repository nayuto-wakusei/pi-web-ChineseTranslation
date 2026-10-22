// @vitest-environment happy-dom
import { translateChinese } from "../localization.testSupport.js";
import { setTranslator } from "./i18n.js";
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html, svg } from "lit";
import type { ApplicationPanelContext, PiWebStatusResponse, PluginActivationResult } from "@chainingintention/pi-web-cn/plugin-api";
import { runtimeContext } from "../../src/client/src/plugins/pluginRuntime.testSupport.js";
import { createWorkspacePanelContext, serializeTemplate } from "../../src/testSupport/plugin";
import plugin from "./pi-web-plugin";

function createApplicationPanelContext(patch: Partial<ApplicationPanelContext> = {}): ApplicationPanelContext {
  return { ...createWorkspacePanelContext(), state: {}, ...patch };
}

beforeEach(() => { setTranslator(translateChinese); });

describe("updates plugin Chinese display text", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("exposes a Chinese panel title", async () => {
    const activation = await activatePlugin();

    expect(plugin.name).toBe("更新");
    expect(activation.contributions.applicationPanels?.[0]?.title).toBe("更新");
  });

  it("renders Chinese loading and status copy", async () => {
    const activation = await activatePlugin();
    const panel = activation.contributions.applicationPanels?.[0];

    expect(serializeTemplate(panel?.render(createApplicationPanelContext()))).toContain("正在检查 PI WEB 更新状态");
    expect(serializeTemplate(panel?.badge?.(createApplicationPanelContext()))).toBe("");

    const rendered = serializeTemplate(panel?.render(createApplicationPanelContext({
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
    expect(rendered).toContain("推荐");
    expect(rendered).toContain("其他命令（可选）");
    expect(rendered.match(/systemctl --user restart pi-web-ui-dev\.service/gu)).toHaveLength(1);
    expect(rendered).toContain("复制");
    expect(rendered).toContain("当前版本");
    expect(rendered).toContain("需要重启");
    expect(rendered).toContain("远程版本检查已跳过。");
  });

  it("keeps run buttons available in management embed mode", async () => {
    vi.stubGlobal("location", { search: "?embed=management&token=launch-token" });
    const activation = await activatePlugin();
    const panel = activation.contributions.applicationPanels?.[0];

    const rendered = serializeTemplate(panel?.render(createApplicationPanelContext({
      state: {
        piWebStatus: statusWithCommands(),
      },
    })));

    expect(rendered).toContain("复制");
    expect(rendered).toContain("class=\"ui-button ui-button--action ui-button--compact ui-button--primary\"");
  });

  it("shows the checked release timestamp only when a remote check was performed", async () => {
    const panel = (await activatePlugin()).contributions.applicationPanels?.[0];
    const status = statusWithCommands();
    status.release.checkedAt = "2026-09-30T10:00:00.000Z";
    status.release.skipped = false;
    const renderStatus = () => serializeTemplate(panel?.render(createApplicationPanelContext({ state: { piWebStatus: status } })));
    expect(renderStatus()).toContain("发布检查时间 2026-09-30T10:00:00.000Z");
    status.release.skipped = true;
    expect(renderStatus()).not.toContain("发布检查时间");
  });

  it("does not throw when the clipboard API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const activation = await activatePlugin();
    const panel = activation.contributions.applicationPanels?.[0];
    const panelContext = createApplicationPanelContext({ state: { piWebStatus: statusWithCommands() } });
    Reflect.set(panelContext, "terminal", undefined);
    const rendered = panel?.render(panelContext);
    const container = document.createElement("div");
    document.body.append(container);
    render(rendered, container);
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "复制");
    expect(button).toBeDefined();
    expect(() => { button?.click(); }).not.toThrow();
  });
});

describe("updates plugin actions", () => {
  it("forces an update check through the host runtime context", async () => {
    const action = (await activatePlugin()).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const checkForPiWebUpdates = vi.fn(() => Promise.resolve());
    const context = runtimeContext({ checkForPiWebUpdates });

    expect(action.title).toBe("检查 PI WEB 更新");
    expect(action.enabled?.(context)).toBe(true);
    await action.run(context);

    expect(checkForPiWebUpdates).toHaveBeenCalledOnce();
  });

  it("disables the action on older hosts without the update-check helper", async () => {
    const action = (await activatePlugin()).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const context = runtimeContext();

    expect(action.enabled?.(context)).toBe(false);
    expect(action.disabledReason?.(context)).toContain("较新版本的 PI WEB 网关");
  });
});

function activatePlugin(): Promise<PluginActivationResult> {
  const signal = new AbortController().signal;
  return Promise.resolve(plugin.activate({ apiVersion: 4, translate: translateChinese, pluginId: "updates", runtimePluginId: "updates", html, svg, signal, lifetimeSignal: signal }));
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
