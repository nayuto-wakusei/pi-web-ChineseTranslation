// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfigResponse } from "../../api";
import { SettingsSessiondPanel } from "./SettingsSessiondPanel";
import { setClientTranslations } from "../../i18n";
import { installNativeDialogFake } from "../nativeDialog.testSupport";
installNativeDialogFake();
beforeEach(() => { setClientTranslations("en", {}); });
import type { CommandPicker } from "../CommandPicker";

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
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

async function mount(config: PiWebConfigResponse | undefined = configResponse()): Promise<SettingsSessiondPanel> {
  const panel = new SettingsSessiondPanel();
  panel.configResponse = config;
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
    const oldBudget = toggle(panel, "session-naming-max-tokens");
    oldBudget.value = "88";
    panel.configResponse = undefined;
    panel.targetId = "machine-b";
    await panel.updateComplete;
    oldForm?.dispatchEvent(new Event("submit", { cancelable: true }));
    oldBudget.dispatchEvent(new Event("change"));
    expect(onSave).not.toHaveBeenCalled();
    const next = configResponse();
    next.config.agent = { command: "pi", dir: "/new" };
    panel.configResponse = next;
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelectorAll<HTMLInputElement>("form input")[1]?.value).toBe("/new");
  });

  it("closes a naming picker and rejects its old catalog callback when only project context changes", async () => {
    const panel = await mount();
    panel.namingModels = [{ provider: "old", id: "model" }];
    panel.namingContextKey = "machine:project-a";
    await panel.updateComplete;
    panel.shadowRoot?.querySelector<HTMLButtonElement>("#session-naming-model")?.click();
    await panel.updateComplete;
    const picker = panel.shadowRoot?.querySelector<CommandPicker>("command-picker");
    const pick = picker?.onPick;
    if (!pick) throw new Error("Missing picker callback");
    const onSave = vi.fn();
    panel.onSave = onSave;
    panel.namingContextKey = "machine:project-b";
    panel.namingModels = [{ provider: "new", id: "model" }];
    await panel.updateComplete;
    pick("old/model");
    expect(panel.shadowRoot?.querySelector("command-picker")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });


  it("separates saved naming values and immediate-effect help from restart permissions", async () => {
    const config = configResponse();
    config.effectiveConfig.sessionNaming = { model: "provider/naming", maxTokens: 64, thinkingLevel: "off", timeoutMs: 30500 };
    const panel = await mount(config);
    const summary = panel.shadowRoot?.querySelector("section[aria-labelledby='naming-summary-heading']");
    expect(summary?.getAttribute("aria-describedby")).toBe("naming-summary-help");
    expect(summary?.querySelector("h3")?.textContent).toBe("For the next naming request");
    expect(summary?.querySelector("small")?.textContent).toBe("Saved naming settings apply without a restart. Existing names and in-progress naming requests are unchanged.");
    expect(Array.from(summary?.querySelectorAll("dd") ?? [], (item) => item.textContent)).toEqual(["provider/naming", "64", "30.5 seconds", "off"]);
    panel.configResponse = configResponse();
    await panel.updateComplete;
    expect(Array.from(summary?.querySelectorAll("dd") ?? [], (item) => item.textContent)).toEqual(["Use session model", "24", "10 seconds", "minimal"]);
  });

  it("searches and selects naming models while preserving naming overrides, and resets defaults", async () => {
    const config = configResponse();
    config.config.sessionNaming = { model: "openai/gpt-5", maxTokens: 48, thinkingLevel: "off", timeoutMs: 30000 };
    const panel = await mount(config);
    panel.namingModels = [
      { provider: "openai", id: "gpt-5", name: "GPT 5" },
      { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
    ];
    const onSave = vi.fn();
    panel.onSave = onSave;
    await panel.updateComplete;
    const model = panel.shadowRoot?.querySelector<HTMLButtonElement>("#session-naming-model");
    expect(model?.textContent).toContain("openai/gpt-5");
    model?.click();
    await panel.updateComplete;
    const picker = panel.shadowRoot?.querySelector<CommandPicker>("command-picker");
    if (!picker) throw new Error("Missing naming model picker");
    await picker.updateComplete;
    const search = picker.shadowRoot?.querySelector("input");
    if (!search) throw new Error("Missing model search");
    search.value = "sonnet";
    search.dispatchEvent(new Event("input"));
    await picker.updateComplete;
    const choices = picker.shadowRoot?.querySelectorAll<HTMLButtonElement>(".options button");
    expect(choices).toHaveLength(1);
    expect(choices?.[0]?.textContent).toContain("Claude Sonnet");
    choices?.[0]?.click();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector("command-picker")).toBeNull();
    expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { model: "anthropic/claude-sonnet", maxTokens: 48, thinkingLevel: "off", timeoutMs: 30000 } });
    const budget = toggle(panel, "session-naming-max-tokens");
    for (const invalid of ["0", "-1", "1.5"]) {
      onSave.mockClear();
      budget.value = invalid;
      budget.dispatchEvent(new Event("change"));
      expect(onSave).not.toHaveBeenCalled();
    }
    budget.value = "64";
    budget.dispatchEvent(new Event("change"));
    expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { model: "openai/gpt-5", maxTokens: 64, thinkingLevel: "off", timeoutMs: 30000 } });
    budget.value = "";
    budget.dispatchEvent(new Event("change"));
    expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { model: "openai/gpt-5", thinkingLevel: "off", timeoutMs: 30000 } });
    model?.click();
    await panel.updateComplete;
    const resetPicker = panel.shadowRoot?.querySelector<CommandPicker>("command-picker");
    if (!resetPicker) throw new Error("Missing naming model picker");
    await resetPicker.updateComplete;
    resetPicker.shadowRoot?.querySelector<HTMLButtonElement>(".options button")?.click();
    await panel.updateComplete;
    expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { maxTokens: 48, thinkingLevel: "off", timeoutMs: 30000 } });
  });

  it("saves thinking overrides including off and resets to minimal without changing the model or budget", async () => {
    const config = configResponse();
    config.config.sessionNaming = { model: "provider/naming", maxTokens: 64, timeoutMs: 30000 };
    const panel = await mount(config);
    const onSave = vi.fn();
    panel.onSave = onSave;
    const select = panel.shadowRoot?.querySelector<HTMLSelectElement>("#session-naming-thinking-level");
    if (!select) throw new Error("Missing thinking-level selector");
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.textContent).toBe("Default (minimal)");
    expect(Array.from(select.options, (option) => option.value)).toEqual(["", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);
    select.value = "off";
    select.dispatchEvent(new Event("change"));
    expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { model: "provider/naming", maxTokens: 64, thinkingLevel: "off", timeoutMs: 30000 } });
    panel.configResponse = { ...config, config: { sessionNaming: { model: "provider/naming", maxTokens: 64, thinkingLevel: "off", timeoutMs: 30000 } } };
    await panel.updateComplete;
    expect(select.value).toBe("off");
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { model: "provider/naming", maxTokens: 64, timeoutMs: 30000 } });
    panel.saving = true;
    await panel.updateComplete;
    expect(select.disabled).toBe(true);
  });

  it("converts timeout seconds to integer milliseconds and clears only the timeout override", async () => {
    const config = configResponse();
    config.config.sessionNaming = { model: "provider/naming", maxTokens: 48, thinkingLevel: "off", timeoutMs: 30500 };
    const panel = await mount(config);
    const onSave = vi.fn();
    panel.onSave = onSave;
    const input = toggle(panel, "session-naming-timeout");
    expect(panel.shadowRoot?.querySelector(`label[for='${input.id}']`)?.textContent).toBe("Naming timeout (seconds)");
    expect(input.value).toBe("30.5");
    expect(input.min).toBe("0.001");
    expect(input.max).toBe("2147483.647");
    expect(input.step).toBe("0.001");
    // happy-dom uses exact floating-point remainder for step validation, rejecting
    // valid fractional seconds. Keep native range checks and emulate step tolerance.
    vi.spyOn(input.validity, "stepMismatch", "get").mockImplementation(() => {
      const milliseconds = input.valueAsNumber * 1000;
      return input.value !== "" && Math.abs(milliseconds - Math.round(milliseconds)) > 0.000001;
    });
    expect(help(panel, input)).toContain("Total timeout includes model loading. Increase it for cold local engines.");
    for (const [seconds, timeoutMs] of [["0.001", 1], ["1.001", 1001], ["2147483.647", 2147483647]] as const) {
      input.value = seconds;
      input.dispatchEvent(new Event("change"));
      expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { model: "provider/naming", maxTokens: 48, thinkingLevel: "off", timeoutMs } });
    }
    for (const invalid of ["0", "-1", "0.0001", "1.0005", "2147483.648"]) {
      onSave.mockClear();
      input.value = invalid;
      input.dispatchEvent(new Event("change"));
      expect(onSave).not.toHaveBeenCalled();
    }
    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect(onSave).toHaveBeenLastCalledWith({ sessionNaming: { model: "provider/naming", maxTokens: 48, thinkingLevel: "off" } });
  });

  it("defaults to the session model and 24 tokens, allows cancel, and disables naming controls during saves", async () => {
    const panel = await mount();
    const onSave = vi.fn();
    panel.onSave = onSave;
    const model = panel.shadowRoot?.querySelector<HTMLButtonElement>("#session-naming-model");
    expect(model?.textContent).toContain("Use session model");
    expect(toggle(panel, "session-naming-max-tokens").placeholder).toBe("24");
    const timeout = toggle(panel, "session-naming-timeout");
    expect(timeout.value).toBe("");
    expect(timeout.placeholder).toBe("10");
    expect(help(panel, timeout)).toContain("Clear to use 10 seconds.");
    model?.click();
    await panel.updateComplete;
    const picker = panel.shadowRoot?.querySelector<CommandPicker>("command-picker");
    if (!picker) throw new Error("Missing picker");
    await picker.updateComplete;
    picker.shadowRoot?.querySelector<HTMLButtonElement>("button[aria-label='Close']")?.click();
    await panel.updateComplete;
    expect(onSave).not.toHaveBeenCalled();
    expect(panel.shadowRoot?.querySelector("command-picker")).toBeNull();
    panel.saving = true;
    await panel.updateComplete;
    expect(model?.disabled).toBe(true);
    expect(toggle(panel, "session-naming-max-tokens").disabled).toBe(true);
    expect(timeout.disabled).toBe(true);
    panel.saving = false;
    panel.loading = true;
    await panel.updateComplete;
    expect(timeout.disabled).toBe(true);
  });

  it("keeps an unavailable saved model visible and explains loading and catalog errors without changing it", async () => {
    const config = configResponse();
    config.config.sessionNaming = { model: "missing/model" };
    const panel = await mount(config);
    const onSave = vi.fn();
    panel.onSave = onSave;
    expect(panel.shadowRoot?.textContent).toContain("The saved naming model is unavailable");
    expect(panel.shadowRoot?.querySelector("#session-naming-model")?.textContent).toContain("missing/model");
    panel.namingModelsLoading = true;
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("Loading naming models");
    expect(panel.shadowRoot?.querySelector<HTMLButtonElement>("#session-naming-model")?.disabled).toBe(true);
    panel.namingModelsLoading = false;
    panel.namingModelsError = "Could not load models.";
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("Could not load models. Refresh settings to try again. Your saved model is unchanged.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes the model picker when the settings target changes", async () => {
    const panel = await mount();
    panel.shadowRoot?.querySelector<HTMLButtonElement>("#session-naming-model")?.click();
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector("command-picker")).not.toBeNull();
    panel.targetLabel = "Another machine";
    await panel.updateComplete;
    expect(panel.shadowRoot?.querySelector("command-picker")).toBeNull();
  });

});
