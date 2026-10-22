// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../pi-web-plugins/zh-cn/components.json";
import { api, type OAuthFlowState } from "../api";
import { setClientTranslations } from "../i18n";
import { AuthDialog } from "./AuthDialog";
import { SettingsMcpPanel } from "./settings/SettingsMcpPanel";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  setClientTranslations("zh-CN", messages);
});

describe("MCP localization boundaries", () => {
  it.each([
    { locale: "en", finished: "Operation finished" },
    { locale: "zh-CN", finished: "操作已结束" },
  ])("localizes operation completion without translating SDK output in $locale", async ({ locale, finished }) => {
    setClientTranslations(locale, locale === "en" ? {} : messages);
    const flow: OAuthFlowState = { flowId: "flow-1", providerId: "mcp", providerName: "Server <raw> {count}", target: "mcp", mcpMode: "login", status: "complete", progress: ["Login denied: raw <message> {count}"] };
    const before = structuredClone(flow);
    const dialog = new AuthDialog();
    dialog.state = { step: "oauth", flow, target: { machineId: "local" } };
    document.body.append(dialog);
    await dialog.updateComplete;
    await dialog.updateComplete;
    expect(dialog.shadowRoot?.textContent).toContain(finished);
    expect(dialog.shadowRoot?.textContent).toContain(flow.providerName);
    expect(dialog.shadowRoot?.textContent).toContain(flow.progress[0]);
    expect(dialog.shadowRoot?.querySelector("raw")).toBeNull();
    expect(flow).toEqual(before);
  });

  it("localizes MCP controls while retaining the exact server identifier and description", async () => {
    setClientTranslations("zh-CN", messages);
    const server = { name: "raw-server", description: "Connected <original> {count}" };
    vi.spyOn(api, "mcpAuthServers").mockResolvedValue({ servers: [server] });
    const panel = new SettingsMcpPanel();
    panel.context = { machineId: "local", session: { id: "s1", cwd: "/repo" } };
    panel.onMcpAuth = vi.fn();
    document.body.append(panel);
    await panel.updateComplete;
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain(server.name);
    expect(panel.shadowRoot?.textContent).toContain(server.description);
    expect(panel.shadowRoot?.querySelector('button[aria-label="登录 raw-server"]')).not.toBeNull();
    expect(panel.shadowRoot?.querySelector('button[aria-label="退出 raw-server 登录"]')).not.toBeNull();
    expect(panel.shadowRoot?.querySelector("original")).toBeNull();
  });
});
