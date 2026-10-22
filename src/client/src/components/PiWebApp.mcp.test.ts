// @vitest-environment happy-dom
import { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, configApi, piPackagesApi, pluginsApi, type SessionInfo } from "../api";
import { initialAppState } from "../appState";
import { AuthController } from "../controllers/authController";
import { PiWebApp } from "./PiWebApp";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, pluginsResponse, remoteMachine } from "./SettingsDialog.testSupport";
import { themeStylesheetFetch } from "./themeStylesheetFetch.testSupport";

class McpSettingsApp extends PiWebApp {
  override connectedCallback(): void {
    LitElement.prototype.connectedCallback.call(this);
  }
}
customElements.define("mcp-settings-test-app", McpSettingsApp);

const session: SessionInfo = { id: "session", path: "/repo/session.jsonl", cwd: "/repo", created: "now", modified: "now", messageCount: 0, firstMessage: "" };
const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Unexpected network request")));

beforeEach(() => {
  unexpectedRequest.mockClear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", themeStylesheetFetch(unexpectedRequest));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(configApi, "namingModels").mockResolvedValue({ models: [] });
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
  vi.spyOn(api, "runtime").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "now", capabilities: [] });
  vi.spyOn(api, "mcpAuthServers").mockResolvedValue({ servers: [{ name: "docs" }] });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(unexpectedRequest).not.toHaveBeenCalled();
});

describe("naming model app settings context", () => {
  it("does not infer normal model credentials when no owning project is selected", async () => {
    const app = await mount(session);
    expect(settings(app).namingModelsTarget).toBeUndefined();
    expect(configApi.namingModels).not.toHaveBeenCalled();
  });

  it("binds model discovery to the selected machine and refreshes the target on a project change", async () => {
    const app = await mount(session);
    const current: unknown = Reflect.get(app, "state");
    if (typeof current !== "object" || current === null) throw new Error("Missing app state");
    Reflect.set(app, "state", { ...current, selectedProject: { id: "project-a", name: "Project A", path: "/repo", createdAt: "now" } });
    await settle(app);
    expect(settings(app).namingModelsTarget).toEqual({ machineId: remoteMachine.id, projectId: "project-a" });
    expect(configApi.namingModels).toHaveBeenCalledWith({ machineId: remoteMachine.id, projectId: "project-a" });
    Reflect.set(app, "state", { ...current, selectedProject: { id: "project-b", name: "Project B", path: "/other", createdAt: "now" } });
    await settle(app);
    expect(settings(app).namingModelsTarget).toEqual({ machineId: remoteMachine.id, projectId: "project-b" });
  });

  it("uses management authentication without inventing a normal project target", async () => {
    window.history.replaceState(null, "", "/?embed=management&token=test-entry");
    const app = await mount(session);
    expect(settings(app).namingModelsTarget).toEqual({ machineId: remoteMachine.id });
    expect(configApi.namingModels).toHaveBeenCalledWith({ machineId: remoteMachine.id });
  });
});

describe("MCP app settings binding", () => {
  it("passes the original machine and session to authentication before closing settings", async () => {
    const app = await mount(session);
    const auth: unknown = Reflect.get(app, "auth");
    if (!(auth instanceof AuthController)) throw new Error("Missing auth controller");
    const open = vi.spyOn(auth, "openMcpAuth").mockResolvedValue();
    const dialog = settings(app);
    const context = { machineId: remoteMachine.id, session: { id: session.id, cwd: session.cwd } };
    expect(dialog.mcpContext).toEqual(context);
    await dialog.onMcpAuth?.("login", "docs", context);
    await settle(app);
    expect(open).toHaveBeenCalledExactlyOnceWith("login", "docs", context);
    expect(app.shadowRoot?.querySelector("settings-dialog")).toBeNull();
  });

  it.each([
    { label: "archived", selectedSession: { ...session, archived: true } },
    { label: "missing", selectedSession: undefined },
  ])("withdraws MCP context for a $label session", async ({ selectedSession }) => {
    const app = await mount(selectedSession);
    expect(settings(app).mcpContext).toBeUndefined();
    expect(api.mcpAuthServers).not.toHaveBeenCalled();
  });
});

async function mount(selectedSession: SessionInfo | undefined): Promise<McpSettingsApp> {
  const app = new McpSettingsApp();
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "settingsSection", "mcp");
  Reflect.set(app, "state", { ...initialAppState(), selectedMachine: remoteMachine, selectedSession });
  document.body.append(app);
  await settle(app);
  return app;
}

function settings(app: PiWebApp): SettingsDialog {
  const dialog = app.shadowRoot?.querySelector("settings-dialog");
  if (!(dialog instanceof SettingsDialog)) throw new Error("Missing settings dialog");
  return dialog;
}

async function settle(element: LitElement): Promise<void> {
  await element.updateComplete;
  for (const child of element.shadowRoot?.querySelectorAll("*") ?? []) {
    if (child instanceof LitElement) await settle(child);
  }
  await element.updateComplete;
}
