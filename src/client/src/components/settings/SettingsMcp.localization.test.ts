// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api";
import { localization } from "../../localization/browser";
import { deferred } from "../SettingsDialog.testSupport";
import { SettingsMcpPanel, mcpMessages as messages } from "./SettingsMcpPanel";
import type { SettingsPanelFrame } from "./SettingsPanelFrame";

const context = { machineId: "raw-machine", session: { id: "session <img>", cwd: "/raw/<img>/العربية" } };
const server = { name: "Raw <img> العربية", description: "Raw SDK <img>\ncredentials unchanged" };
const releases: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(api, "mcpAuthServers").mockResolvedValue({ servers: [server] });
});
afterEach(async () => {
  document.body.replaceChildren();
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
  vi.restoreAllMocks();
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing MCP settings control");
  return value;
}
function frame(panel: SettingsMcpPanel): SettingsPanelFrame {
  return required(panel.renderRoot.querySelector("settings-panel-frame"));
}
async function settle(panel: SettingsMcpPanel): Promise<void> {
  await panel.updateComplete;
  await panel.updateComplete;
  await frame(panel).updateComplete;
}
async function mount(): Promise<SettingsMcpPanel> {
  const panel = new SettingsMcpPanel();
  panel.context = context;
  panel.targetLabel = "Raw target <img>";
  panel.onMcpAuth = vi.fn();
  document.body.append(panel);
  await settle(panel);
  return panel;
}
async function language(panel: SettingsMcpPanel, language: string): Promise<void> {
  await localization.setPreferences({ language, formatLocale: "ar-EG" });
  await settle(panel);
}
function button(panel: SettingsMcpPanel, index = 0): HTMLButtonElement {
  return required(panel.renderRoot.querySelectorAll<HTMLButtonElement>("li button")[index]);
}
function notice(panel: SettingsMcpPanel): string {
  return frame(panel).shadowRoot?.querySelector('[role="alert"]')?.textContent ?? "";
}

it("updates all MCP controls live, preserving nodes, focus, raw server content and action origin", async () => {
  releases.push(localization.registerCatalog({ id: "mcp-test", namespace: "core.settingsMcp", locale: "de", load: () => Promise.resolve({ heading: "MCP-Verwaltung", refresh: "Aktualisieren", login: "Anmelden", loginAria: "Bei {name} anmelden", context: "Sitzungskontext" }) }));
  const panel = await mount();
  const login = button(panel);
  const row = panel.renderRoot.querySelector("li");
  login.focus();
  for (const locale of ["de", "en-XA", "ar-XB"]) {
    await language(panel, locale);
    expect(button(panel)).toBe(login);
    expect(panel.renderRoot.querySelector("li")).toBe(row);
    expect(panel.shadowRoot?.activeElement).toBe(login);
    expect(login.textContent).toBe(messages.t("login"));
    expect(login.getAttribute("aria-label")).toBe(messages.t("loginAria", { name: server.name }));
    expect(button(panel, 1).getAttribute("aria-label")).toBe(messages.t("logoutAria", { name: server.name }));
    expect(button(panel, 1).textContent).toBe(messages.t("logout"));
    expect(frame(panel).heading).toBe(messages.t("heading"));
    expect(frame(panel).description).toBe(messages.t("description"));
    expect(frame(panel).actionLabel).toBe(messages.t("refresh"));
    expect(panel.renderRoot.querySelector(".session-context")?.getAttribute("aria-label")).toBe(messages.t("contextAria"));
    expect(panel.renderRoot.querySelector("ul")?.getAttribute("aria-label")).toBe(messages.t("serversAria"));
    for (const key of ["context", "machine", "session", "workspace", "logoutHelp"] as const) expect(panel.renderRoot.textContent).toContain(messages.t(key));
    for (const raw of [context.session.id, context.session.cwd, panel.targetLabel, server.name, server.description]) expect(panel.renderRoot.textContent).toContain(raw);
    expect(panel.renderRoot.querySelector("img")).toBeNull();
    expect(api.mcpAuthServers).toHaveBeenCalledOnce();
    expect(panel.onMcpAuth).not.toHaveBeenCalled();
  }
  login.click();
  button(panel, 1).click();
  expect(panel.onMcpAuth).toHaveBeenNthCalledWith(1, "login", server.name, context);
  expect(panel.onMcpAuth).toHaveBeenNthCalledWith(2, "logout", server.name, context);
});

it("keeps a pending server load and localizes its retained failure without issuing another request", async () => {
  const pending = deferred<{ servers: typeof server[] }>();
  vi.mocked(api.mcpAuthServers).mockReturnValueOnce(pending.promise);
  const panel = await mount();
  await language(panel, "ar-XB");
  expect(panel.renderRoot.textContent).toContain(messages.t("loading"));
  expect(frame(panel).actionDisabled).toBe(true);
  pending.reject(new Error("Raw <img> offline"));
  await settle(panel);
  for (const locale of ["en-XA", "ar-XB", "en"]) {
    await language(panel, locale);
    expect(notice(panel)).toContain(messages.t("loadError", { error: "Raw <img> offline" }));
    expect(panel.renderRoot.textContent).not.toContain(messages.t("empty"));
    expect(frame(panel).shadowRoot?.querySelector("img")).toBeNull();
  }
  expect(api.mcpAuthServers).toHaveBeenCalledOnce();
  required(frame(panel).shadowRoot?.querySelector("button")).click();
  await settle(panel);
  expect(frame(panel).notices).toEqual([]);
  expect(button(panel).textContent).toBe(messages.t("login"));
  expect(api.mcpAuthServers).toHaveBeenCalledTimes(2);
});

it("keeps pending authentication and its diagnostic live without replaying login", async () => {
  const panel = await mount();
  const pending = deferred<undefined>();
  panel.onMcpAuth = vi.fn(() => pending.promise);
  button(panel).click();
  await language(panel, "ar-XB");
  expect(panel.onMcpAuth).toHaveBeenCalledExactlyOnceWith("login", server.name, context);
  pending.reject(new Error("Raw <img> cannot open"));
  await settle(panel);
  for (const locale of ["en-XA", "ar-XB"]) {
    await language(panel, locale);
    expect(notice(panel)).toContain(messages.t("authError", { error: "Raw <img> cannot open" }));
    expect(frame(panel).shadowRoot?.querySelector("img")).toBeNull();
  }
  expect(panel.onMcpAuth).toHaveBeenCalledOnce();
  expect(api.mcpAuthServers).toHaveBeenCalledOnce();
});

it("localizes empty, no-session and fallback target guidance without making ineligible requests", async () => {
  vi.mocked(api.mcpAuthServers).mockResolvedValue({ servers: [] });
  const panel = await mount();
  await language(panel, "ar-XB");
  expect(panel.renderRoot.textContent).toContain(messages.t("empty"));
  panel.context = undefined;
  await settle(panel);
  expect(panel.renderRoot.textContent).toContain(messages.t("selectSession", { target: panel.targetLabel }));
  panel.targetLabel = "";
  await language(panel, "en-XA");
  expect(panel.renderRoot.textContent).toContain(messages.t("selectSession", { target: messages.t("thisMachine") }));
  expect(frame(panel).actionDisabled).toBe(true);
  expect(api.mcpAuthServers).toHaveBeenCalledOnce();
});

it("reconnects in the current language with exactly one fresh context load", async () => {
  const panel = await mount();
  panel.remove();
  await language(panel, "ar-XB");
  document.body.append(panel);
  await settle(panel);
  expect(button(panel).textContent).toBe(messages.t("login"));
  expect(api.mcpAuthServers).toHaveBeenCalledTimes(2);
});
