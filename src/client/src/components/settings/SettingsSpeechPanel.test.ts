// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfigResponse } from "../../api";
import { setClientTranslations } from "../../i18n";
import {
  SettingsSpeechPanel,
  emptySpeechSettingsDraft,
  speechConfigFromDraft,
  speechConfigUnsetPaths,
  speechConfigValidationError,
  speechSettingsDraftFromConfig,
} from "./SettingsSpeechPanel";

beforeEach(() => { setClientTranslations("en", {}); });

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

function configResponse(config: PiWebConfigResponse["config"] = {}): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, sessionMessages: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

async function mount(config: PiWebConfigResponse = configResponse(), loadApiKey?: () => Promise<string>): Promise<SettingsSpeechPanel> {
  const panel = new SettingsSpeechPanel();
  panel.configResponse = config;
  if (loadApiKey !== undefined) panel.onLoadApiKey = loadApiKey;
  document.body.append(panel);
  await panel.updateComplete;
  await Promise.resolve();
  await panel.updateComplete;
  return panel;
}

function field(panel: SettingsSpeechPanel, id: string): HTMLInputElement | HTMLSelectElement {
  const element = panel.shadowRoot?.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (element === null || element === undefined) throw new Error(`missing field: ${id}`);
  return element;
}

function type(panel: SettingsSpeechPanel, id: string, value: string): void {
  const element = field(panel, id);
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(panel: SettingsSpeechPanel): Promise<void> {
  const form = panel.shadowRoot?.querySelector("form");
  if (form === null || form === undefined) throw new Error("missing form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
}

describe("speech settings draft", () => {
  it("maps saved config to a draft and omits defaults on the way back", () => {
    const draft = speechSettingsDraftFromConfig({ endpoint: "http://gpu.test:8080", model: "qwen3-asr-0.6b", language: "zh", apiKeyEnv: "TOKEN" });
    expect(draft).toEqual({ endpoint: "http://gpu.test:8080", api: "transcriptions", model: "qwen3-asr-0.6b", language: "zh", apiKey: "", apiKeyEnv: "TOKEN" });
    expect(speechConfigFromDraft(draft)).toEqual({ speech: { endpoint: "http://gpu.test:8080", model: "qwen3-asr-0.6b", language: "zh", apiKeyEnv: "TOKEN" } });
    expect(speechConfigFromDraft({ ...emptySpeechSettingsDraft(), api: "chat" })).toEqual({ speech: { api: "chat" } });
  });

  it("treats cleared saved leaves as explicit unsets", () => {
    expect(speechConfigUnsetPaths({ ...emptySpeechSettingsDraft(), endpoint: "http://gpu.test:8080" }, { endpoint: "http://old.test:8080", language: "zh" })).toEqual(["/speech/language"]);
  });

  it("validates the endpoint, language, and key variable name", () => {
    expect(speechConfigValidationError(emptySpeechSettingsDraft())).toBe("");
    expect(speechConfigValidationError({ ...emptySpeechSettingsDraft(), endpoint: "gpu.test:8080" })).not.toBe("");
    expect(speechConfigValidationError({ ...emptySpeechSettingsDraft(), endpoint: "http://user:pass@gpu.test" })).not.toBe("");
    expect(speechConfigValidationError({ ...emptySpeechSettingsDraft(), language: "中文" })).not.toBe("");
    expect(speechConfigValidationError({ ...emptySpeechSettingsDraft(), apiKeyEnv: "1BAD" })).not.toBe("");
    expect(speechConfigValidationError({ ...emptySpeechSettingsDraft(), endpoint: "https://gpu.test/v1", language: "en-US", apiKeyEnv: "_KEY" })).toBe("");
  });
});

describe("SettingsSpeechPanel", () => {
  it("backfills a saved key without resending it on unrelated edits, and clearing the input removes it", async () => {
    const response = configResponse({ speech: { model: "asr" } });
    response.speechApiKeyPresence = { config: true, effectiveConfig: true, defaultsConfig: false };
    const load = vi.fn(() => Promise.resolve("backfilled-test-key"));
    const panel = await mount(response, load);
    const onSave = vi.fn();
    panel.onSave = onSave;
    expect(load).toHaveBeenCalledOnce();
    expect(field(panel, "speech-api-key").value).toBe("backfilled-test-key");
    expect(field(panel, "speech-api-key").type).toBe("password");
    type(panel, "speech-language", "zh");
    await submit(panel);
    expect(onSave).toHaveBeenLastCalledWith({ speech: { language: "zh" } }, undefined);
    type(panel, "speech-api-key", "");
    await submit(panel);
    expect(onSave).toHaveBeenLastCalledWith({ speech: { language: "zh" } }, ["/speech/apiKey"]);
  });

  it("ignores a late secret read after switching machines", async () => {
    let resolveKey: (value: string) => void = () => undefined;
    const pending = new Promise<string>(resolve => { resolveKey = resolve; });
    const response = configResponse();
    response.speechApiKeyPresence = { config: true, effectiveConfig: true, defaultsConfig: false };
    const panel = await mount(response, () => pending);
    panel.targetId = "other-machine";
    panel.configResponse = configResponse();
    await panel.updateComplete;
    resolveKey("previous-machine-test-key");
    await Promise.resolve();
    await panel.updateComplete;
    expect(field(panel, "speech-api-key").value).toBe("");
  });

  it("keeps saved keys hidden and unchanged until replaced or explicitly cleared", async () => {
    const response = configResponse({ speech: { model: "asr", apiKeyEnv: "SPEECH_TOKEN" } });
    response.speechApiKeyPresence = { config: true, effectiveConfig: true, defaultsConfig: false };
    const panel = await mount(response);
    const onSave = vi.fn();
    panel.onSave = onSave;
    expect(field(panel, "speech-api-key").type).toBe("password");
    expect(field(panel, "speech-api-key").value).toBe("");
    type(panel, "speech-language", "zh");
    await submit(panel);
    expect(onSave).toHaveBeenLastCalledWith({ speech: { language: "zh" } }, undefined);

    const clear = [...(panel.shadowRoot?.querySelectorAll("button") ?? [])].find(button => button.textContent.includes("Clear saved API key"));
    if (!clear) throw new Error("missing clear key button");
    clear.click();
    await panel.updateComplete;
    await submit(panel);
    expect(onSave).toHaveBeenLastCalledWith({ speech: { language: "zh" } }, ["/speech/apiKey"]);

    type(panel, "speech-api-key", " replacement-test-key ");
    await submit(panel);
    expect(onSave).toHaveBeenLastCalledWith({ speech: { language: "zh", apiKey: "replacement-test-key" } }, undefined);
    expect(localStorage.length).toBe(0);
    panel.targetId = "other-machine";
    panel.configResponse = configResponse({ speech: { model: "other" } });
    await panel.updateComplete;
    expect(field(panel, "speech-api-key").value).toBe("");
    await submit(panel);
    expect(onSave).toHaveBeenLastCalledWith({}, undefined);
  });

  it("clears a successfully saved secret draft and locks environment-enforced keys", async () => {
    const panel = await mount();
    type(panel, "speech-model", " asr ");
    type(panel, "speech-api-key", "temporary-test-key");
    const response = configResponse({ speech: { model: "asr" } });
    response.speechApiKeyPresence = { config: true, effectiveConfig: true, defaultsConfig: false };
    response.enforcedSettings = { "/speech/apiKey": "PI_WEB_SPEECH" };
    panel.configResponse = response;
    panel.savedMessage = "Saved";
    await panel.updateComplete;
    expect(field(panel, "speech-api-key").value).toBe("");
    expect(field(panel, "speech-api-key").disabled).toBe(true);
    expect(panel.shadowRoot?.querySelector<HTMLButtonElement>(".api-key-status button")?.disabled).toBe(true);
  });

  it("discards secret drafts when disconnected", async () => {
    const panel = await mount();
    type(panel, "speech-api-key", "temporary-test-key");
    panel.remove();
    document.body.append(panel);
    await panel.updateComplete;
    expect(field(panel, "speech-api-key").value).toBe("");
  });

  it("saves only changed speech settings", async () => {
    const panel = await mount(configResponse({ speech: { endpoint: "http://old.test:8080", model: "old-model" } }));
    const onSave = vi.fn();
    panel.onSave = onSave;

    type(panel, "speech-endpoint", "http://gpu.test:8080");
    type(panel, "speech-model", "qwen3-asr-0.6b");
    type(panel, "speech-language", "zh");
    await submit(panel);

    expect(onSave).toHaveBeenCalledWith({ speech: { endpoint: "http://gpu.test:8080", model: "qwen3-asr-0.6b", language: "zh" } }, undefined);
  });

  it("unsets saved leaves the user cleared", async () => {
    const panel = await mount(configResponse({ speech: { endpoint: "http://gpu.test:8080", language: "zh" } }));
    const onSave = vi.fn();
    panel.onSave = onSave;

    type(panel, "speech-language", "");
    await submit(panel);

    expect(onSave).toHaveBeenCalledWith({}, ["/speech/language"]);
  });

  it("blocks an invalid endpoint before saving", async () => {
    const panel = await mount();
    const onSave = vi.fn();
    panel.onSave = onSave;

    type(panel, "speech-endpoint", "not-a-url");
    await submit(panel);
    await panel.updateComplete;

    expect(onSave).not.toHaveBeenCalled();
    expect(panel.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain("absolute");
  });

  it("clears the whole speech namespace on reset", async () => {
    const panel = await mount(configResponse({ speech: { endpoint: "http://gpu.test:8080" } }));
    const onReset = vi.fn();
    panel.onReset = onReset;

    const reset = [...(panel.shadowRoot?.querySelectorAll("button") ?? [])].find((button) => button.textContent.includes("Clear"));
    if (reset === undefined) throw new Error("missing reset button");
    reset.click();
    await Promise.resolve();

    expect(onReset).toHaveBeenCalledWith(["/speech"]);
  });

  it("disables fields locked by environment policy", async () => {
    const response = configResponse({ speech: { endpoint: "http://gpu.test:8080", model: "qwen3-asr-0.6b" } });
    response.enforcedSettings = { "/speech/endpoint": "PI_WEB_SPEECH" };
    const panel = await mount(response);
    expect(field(panel, "speech-endpoint").disabled).toBe(true);
    expect(field(panel, "speech-model").disabled).toBe(false);
  });
});
