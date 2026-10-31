// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfigResponse } from "../../api";
import { SettingsSessiondPanel } from "./SettingsSessiondPanel";
import { setClientTranslations } from "../../i18n";
beforeEach(() => { setClientTranslations("en", {}); });

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

function configResponse(): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config: { spawnSessions: false, subsessions: true, askUser: false },
    effectiveConfig: { spawnSessions: true, subsessions: true, askUser: true },
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, sessionMessages: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

async function mount(config: PiWebConfigResponse = configResponse()): Promise<SettingsSessiondPanel> {
  const panel = new SettingsSessiondPanel();
  panel.configResponse = { ...config, effectiveConfig: { ...config.config, ...config.effectiveConfig } };
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function toggle(panel: SettingsSessiondPanel, id: string): HTMLInputElement {
  const input = panel.shadowRoot?.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`Missing toggle: ${id}`);
  return input;
}

function help(panel: SettingsSessiondPanel, input: HTMLInputElement): string {
  const description = panel.shadowRoot?.getElementById(input.getAttribute("aria-describedby") ?? "");
  if (!description) throw new Error("Missing accessible toggle description");
  return description.textContent;
}

describe("SettingsSessiondPanel DOM", () => {
  it("discards old machine profile drafts and refuses detached old controls even with identical machine labels", async () => {
    const config = configResponse();
    config.config.agent = { command: "pi", dir: "/original" };
    const panel = await mount(config);
    panel.targetId = "machine-a";
    const onSave = vi.fn();
    panel.onSave = onSave;
    await panel.updateComplete;
    const inputs = panel.shadowRoot?.querySelectorAll<HTMLInputElement>("form input");
    const dir = inputs?.[1];
    if (!dir) throw new Error("Missing profile directory");
    dir.value = "/old-unsaved";
    dir.dispatchEvent(new Event("input"));
    await panel.updateComplete;
    const oldForm = panel.shadowRoot?.querySelector("form");
    panel.configResponse = undefined;
    panel.targetId = "machine-b";
    await panel.updateComplete;
    oldForm?.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onSave).not.toHaveBeenCalled();
    const next = configResponse();
    next.config.agent = { command: "pi", dir: "/new" };
    panel.configResponse = next;
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelectorAll<HTMLInputElement>("form input")[1]?.value).toBe("/new");
  });


  it("disables child sessions without a parent and all controls while saving", async () => {
    const config = configResponse();
    config.effectiveConfig.spawnSessions = false;
    const panel = await mount(config);
    expect(toggle(panel, "subsessions").disabled).toBe(true);
    expect(help(panel, toggle(panel, "subsessions"))).toContain("Enable “Allow agents to start sessions” first.");
    panel.saving = true;
    await panel.updateComplete;
    for (const id of ["spawn-sessions", "subsessions", "session-messages", "ask-user"]) {
      expect(toggle(panel, id).disabled).toBe(true);
    }
  });

  it("summarizes next-restart values after overrides and parent dependencies, not active state", async () => {
    const config = configResponse();
    config.effectiveConfig.spawnSessions = false;
    const panel = await mount(config);
    const summary = panel.shadowRoot?.querySelector("section.effective-card");
    expect(summary?.getAttribute("aria-labelledby")).toBe("restart-summary-heading");
    expect(summary?.getAttribute("aria-describedby")).toBe("restart-summary-help");
    expect(summary?.querySelector("h3")?.textContent).toBe("After the next daemon restart");
    expect(summary?.querySelector("small")?.textContent).toContain("This does not show the running daemon’s active settings.");
    expect(Array.from(summary?.querySelectorAll("dd") ?? [], (item) => item.textContent).slice(-4)).toEqual(["Disabled", "Disabled", "Enabled", "Enabled"]);
  });

  it("keeps messaging independent of spawning, saves explicit choices, and resets saved overrides", async () => {
    const config = configResponse();
    config.effectiveConfig.spawnSessions = false;
    config.config.sessionMessages = false;
    config.effectiveConfig.sessionMessages = true;
    config.configSources = { "/sessionMessages": "defaults" };
    const panel = await mount(config);
    const onSave = vi.fn();
    const onReset = vi.fn();
    panel.onSave = onSave;
    panel.onReset = onReset;
    await panel.updateComplete;
    const messages = toggle(panel, "session-messages");
    expect(messages.checked).toBe(true);
    expect(messages.disabled).toBe(false);
    messages.click();
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ sessionMessages: false });
    const reset = panel.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Reset saved override for /sessionMessages"]');
    expect(reset).not.toBeNull();
    reset?.click();
    expect(onReset).toHaveBeenCalledExactlyOnceWith(["/sessionMessages"]);

    panel.configResponse = { ...config, enforcedSettings: { "/sessionMessages": "PI_WEB_SESSION_MESSAGES" }, effectiveConfig: { ...config.effectiveConfig, sessionMessages: false } };
    await panel.updateComplete;
    expect(messages.checked).toBe(false);
    expect(messages.disabled).toBe(true);
    expect(help(panel, messages)).toContain("PI_WEB_SESSION_MESSAGES");
    expect(reset?.disabled).toBe(true);
    messages.click();
    reset?.click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
  });




});
