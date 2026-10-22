// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientTranslations } from "../../i18n";
import { api } from "../../api";
import { deferred } from "../SettingsDialog.testSupport";
import { SettingsMcpPanel, type McpAuthContext } from "./SettingsMcpPanel";
import type { SettingsPanelFrame } from "./SettingsPanelFrame";

const context: McpAuthContext = { machineId: "remote-a", session: { id: "session-a", cwd: "/workspace/a" } };

beforeEach(() => {
  setClientTranslations("en", {});
  vi.spyOn(api, "mcpAuthServers").mockResolvedValue({ servers: [] });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function settle(panel: SettingsMcpPanel): Promise<void> {
  await panel.updateComplete;
  await panel.updateComplete;
  await frame(panel).updateComplete;
}

async function mount(origin: McpAuthContext | undefined = context): Promise<SettingsMcpPanel> {
  const panel = new SettingsMcpPanel();
  panel.context = origin;
  panel.targetLabel = "Build Box";
  panel.onMcpAuth = vi.fn();
  document.body.append(panel);
  await settle(panel);
  return panel;
}

function frame(panel: SettingsMcpPanel): SettingsPanelFrame {
  const result = panel.shadowRoot?.querySelector("settings-panel-frame");
  if (!result) throw new Error("Missing frame");
  return result;
}

function refresh(panel: SettingsMcpPanel): HTMLButtonElement {
  const result = frame(panel).shadowRoot?.querySelector("button");
  if (!result) throw new Error("Missing refresh button");
  return result;
}

function action(panel: SettingsMcpPanel, label: string): HTMLButtonElement {
  const result = panel.shadowRoot?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}

describe("MCP settings DOM", () => {
  it.each([
    { machineId: "remote-b", session: { ...context.session } },
    { ...context, session: { ...context.session, id: "session-b" } },
    { ...context, session: { ...context.session, cwd: "/other" } },
  ])("invalidates rows and late loads when only one context identity changes (%j)", async (next) => {
    const pending = deferred<{ servers: { name: string }[] }>();
    vi.mocked(api.mcpAuthServers).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ servers: [{ name: "current" }] });
    const panel = await mount();
    panel.context = next;
    await settle(panel);
    pending.resolve({ servers: [{ name: "obsolete" }] });
    await settle(panel);
    expect(api.mcpAuthServers).toHaveBeenLastCalledWith(next.session, next.machineId);
    expect(panel.shadowRoot?.textContent).toContain("current");
    expect(panel.shadowRoot?.textContent).not.toContain("obsolete");
  });

  it("leaves a readonly MCP context without enabled authentication actions", async () => {
    vi.mocked(api.mcpAuthServers).mockResolvedValue({ servers: [{ name: "docs" }] });
    const panel = await mount();
    panel.onMcpAuth = undefined;
    await settle(panel);
    expect(action(panel, "Login to docs").disabled).toBe(true);
    expect(action(panel, "Logout from docs").disabled).toBe(true);
  });

  it("requires a selected nonarchived session without making a request", async () => {
    const panel = new SettingsMcpPanel();
    panel.targetLabel = "Build Box";
    document.body.append(panel);
    await settle(panel);
    expect(panel.shadowRoot?.textContent).toContain("Select a nonarchived session on Build Box");
    expect(refresh(panel).disabled).toBe(true);
    refresh(panel).click();
    expect(api.mcpAuthServers).not.toHaveBeenCalled();
  });

  it("shows context, preserves SDK descriptions and sends both actions with captured origin", async () => {
    const description = "Connected? <not a status>\nSDK description unchanged";
    vi.mocked(api.mcpAuthServers).mockResolvedValue({ servers: [{ name: "docs", description }] });
    const panel = await mount();
    expect(api.mcpAuthServers).toHaveBeenCalledWith(context.session, "remote-a");
    expect(frame(panel).shadowRoot?.querySelector(".description")?.textContent).toContain("enabled MCP servers that support OAuth");
    expect(panel.shadowRoot?.textContent).toContain("session-a");
    expect(panel.shadowRoot?.textContent).toContain("/workspace/a");
    expect(panel.shadowRoot?.querySelector(".server-description")?.textContent).toBe(description);
    expect(panel.shadowRoot?.textContent).toContain("does not disable the server or revoke access at the provider");
    action(panel, "Login to docs").click();
    action(panel, "Logout from docs").click();
    expect(panel.onMcpAuth).toHaveBeenNthCalledWith(1, "login", "docs", context);
    expect(panel.onMcpAuth).toHaveBeenNthCalledWith(2, "logout", "docs", context);
    expect(panel.shadowRoot?.querySelectorAll("li button")).toHaveLength(2);
  });

  it("shows loading, empty and error states and retries through refresh", async () => {
    const request = deferred<{ servers: { name: string }[] }>();
    vi.mocked(api.mcpAuthServers).mockReturnValueOnce(request.promise);
    const panel = await mount();
    expect(panel.shadowRoot?.textContent).toContain("Loading MCP servers");
    expect(refresh(panel).disabled).toBe(true);
    request.resolve({ servers: [] });
    await settle(panel);
    expect(panel.shadowRoot?.textContent).toContain("No enabled MCP servers with OAuth support");
    vi.mocked(api.mcpAuthServers).mockRejectedValueOnce(new Error("offline"));
    refresh(panel).click();
    await settle(panel);
    expect(frame(panel).shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain("offline");
    expect(panel.shadowRoot?.textContent).not.toContain("No enabled MCP servers");
    refresh(panel).click();
    await settle(panel);
    expect(frame(panel).notices).toEqual([]);
    expect(api.mcpAuthServers).toHaveBeenCalledTimes(3);
  });

  it("clears old rows immediately and ignores late success or failure after context changes", async () => {
    vi.mocked(api.mcpAuthServers).mockResolvedValueOnce({ servers: [{ name: "old" }] });
    const panel = await mount();
    const stale = deferred<{ servers: { name: string }[] }>();
    vi.mocked(api.mcpAuthServers).mockReturnValueOnce(stale.promise);
    refresh(panel).click();
    await settle(panel);
    expect(panel.shadowRoot?.querySelector("li")).toBeNull();
    panel.context = { machineId: "remote-b", session: { id: "session-b", cwd: "/workspace/b" } };
    await settle(panel);
    stale.resolve({ servers: [{ name: "stale" }] });
    await settle(panel);
    expect(panel.shadowRoot?.textContent).not.toContain("stale");
    const failure = deferred<{ servers: { name: string }[] }>();
    vi.mocked(api.mcpAuthServers).mockReturnValueOnce(failure.promise);
    refresh(panel).click();
    await settle(panel);
    panel.context = undefined;
    await settle(panel);
    failure.reject(new Error("stale error"));
    await settle(panel);
    expect(frame(panel).notices).toEqual([]);
    expect(panel.shadowRoot?.querySelector("li")).toBeNull();
  });

  it("invalidates pending loads on disconnect and reloads on reconnect", async () => {
    const request = deferred<{ servers: { name: string }[] }>();
    vi.mocked(api.mcpAuthServers).mockReturnValueOnce(request.promise);
    const panel = await mount();
    panel.remove();
    request.resolve({ servers: [{ name: "stale" }] });
    await Promise.resolve();
    document.body.append(panel);
    await settle(panel);
    expect(api.mcpAuthServers).toHaveBeenCalledTimes(2);
    expect(panel.shadowRoot?.querySelector("li")).toBeNull();
  });

  it("does not refetch when the parent recreates an equivalent context", async () => {
    const panel = await mount();
    panel.context = { machineId: context.machineId, session: { ...context.session } };
    await settle(panel);
    expect(api.mcpAuthServers).toHaveBeenCalledOnce();
  });

  it("keeps an in-flight action tied to its captured origin and ignores its late error", async () => {
    vi.mocked(api.mcpAuthServers).mockResolvedValue({ servers: [{ name: "docs" }] });
    const panel = await mount();
    const pending = deferred<undefined>();
    const callback = vi.fn().mockReturnValue(pending.promise);
    panel.onMcpAuth = callback;
    await settle(panel);
    action(panel, "Logout from docs").click();
    panel.context = { machineId: "remote-b", session: { id: "session-b", cwd: "/workspace/b" } };
    await settle(panel);
    pending.reject(new Error("old action failed"));
    await settle(panel);
    expect(callback).toHaveBeenCalledExactlyOnceWith("logout", "docs", context);
    expect(frame(panel).notices).toEqual([]);
  });

  it("reports callback failures without turning them into authentication status", async () => {
    vi.mocked(api.mcpAuthServers).mockResolvedValue({ servers: [{ name: "docs" }] });
    const panel = await mount();
    panel.onMcpAuth = vi.fn().mockRejectedValue(new Error("cannot open"));
    await settle(panel);
    action(panel, "Login to docs").click();
    await settle(panel);
    expect(frame(panel).notices[0]?.content).toContain("cannot open");
  });
});
