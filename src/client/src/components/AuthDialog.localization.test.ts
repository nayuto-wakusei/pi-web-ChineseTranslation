// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { authMessages } from "../authMessages";
import type { AuthDialogState } from "../appState";
import { AuthDialog } from "./AuthDialog";
import type { ModalSurface } from "./ModalSurface";

let releaseCatalog: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  releaseCatalog?.();
  releaseCatalog = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
  vi.restoreAllMocks();
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected authentication element");
  return value;
}

function root(dialog: AuthDialog): ShadowRoot {
  return required(dialog.shadowRoot);
}

async function mount(state: AuthDialogState): Promise<AuthDialog> {
  const dialog = new AuthDialog();
  dialog.state = state;
  document.body.append(dialog);
  await settle(dialog);
  return dialog;
}

async function settle(dialog: AuthDialog): Promise<void> {
  await dialog.updateComplete;
  await dialog.shadowRoot?.querySelector<ModalSurface>("modal-surface")?.updateComplete;
  await dialog.updateComplete;
}

async function language(dialog: AuthDialog, language: string): Promise<void> {
  await localization.setPreferences({ language, formatLocale: "de-DE" });
  await settle(dialog);
}

it("refreshes provider search, names, badges and details from a real partial catalog without changing identity or invoking actions", async () => {
  releaseCatalog = localization.registerCatalog({ id: "auth-test", namespace: "core.auth", locale: "de", load: () => Promise.resolve({
    selectSubscription: "Abonnement auswählen", search: "Anbieter suchen", configured: "✓ eingerichtet", typeSubscription: "Abonnement",
    providerDetail: "{type}: {provider}",
  }) });
  const dialog = await mount({ step: "providers", target: { machineId: "local" }, authType: "oauth", mode: "login", providers: [
    { id: "provider-id", name: "Provider <b>name</b>", authType: "oauth", status: { configured: true, source: "stored" } },
  ] });
  const onSelect = vi.fn();
  dialog.onSelectProvider = onSelect;
  const input = required(root(dialog).querySelector("input"));
  input.value = "provider";
  input.dispatchEvent(new Event("input"));
  await settle(dialog);
  input.focus();
  await language(dialog, "de");
  expect(root(dialog).activeElement).toBe(input);
  expect(input.value).toBe("provider");
  expect(input.getAttribute("aria-label")).toBe("Anbieter suchen");
  expect(required(root(dialog).querySelector("strong")).textContent).toBe("Abonnement auswählen");
  expect(required(root(dialog).querySelector("em")).textContent).toBe("✓ eingerichtet");
  expect(required(root(dialog).querySelector("small")).textContent).toBe("Abonnement: provider-id");
  expect(required(root(dialog).querySelector("bdi")).textContent).toBe("Provider <b>name</b>");
  expect(root(dialog).querySelector("b")).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  required(root(dialog).querySelector<HTMLButtonElement>(".options button")).click();
  expect(onSelect).toHaveBeenCalledWith("provider-id", "oauth");
});

it("retains prompt edits, focus, provider messages and callback values across pseudo/RTL changes", async () => {
  const state: AuthDialogState = { step: "oauth", target: { machineId: "remote" }, inputValue: "half-typed URL", flow: {
    flowId: "flow", providerId: "provider", providerName: "User provider", status: "running", progress: ["Unchanged provider progress"],
    auth: { url: "https://provider.test/authorize", instructions: "Unchanged provider instructions" },
    prompt: { requestId: "request", promptType: "manual_code", message: "Unchanged provider prompt", placeholder: "Unchanged placeholder" },
    info: [{ message: "Unchanged information", links: [{ label: "Unchanged link", url: "https://provider.test/help" }] }],
  } };
  const dialog = await mount(state);
  const onInput = vi.fn();
  const onRespond = vi.fn();
  dialog.onOAuthInput = onInput;
  dialog.onOAuthRespond = onRespond;
  const input = required(root(dialog).querySelector("input"));
  input.value = "not-yet-echoed edit";
  input.focus();
  for (const locale of ["en-XA", "ar-XB"]) {
    await language(dialog, locale);
    expect(dialog.state).toBe(state);
    expect(root(dialog).activeElement).toBe(input);
    expect(input.value).toBe("not-yet-echoed edit");
    expect(input.placeholder).toBe("Unchanged placeholder");
    expect(required(root(dialog).querySelector("label bdi")).textContent).toBe("Unchanged provider prompt");
    expect(required(root(dialog).querySelector(".progress li")).textContent).toBe("Unchanged provider progress");
    expect(required(root(dialog).querySelector(".info-links a")).textContent).toBe("Unchanged link");
    expect(required(root(dialog).querySelector("a")).href).toBe("https://provider.test/authorize");
    expect(required(root(dialog).querySelector("header button")).getAttribute("aria-label")).toBe(authMessages.t("close"));
    expect(required(root(dialog).querySelector(".actions button:last-child")).textContent).toBe(authMessages.t("submit"));
  }
  expect(onInput).not.toHaveBeenCalled();
  expect(onRespond).not.toHaveBeenCalled();
  input.dispatchEvent(new Event("input"));
  expect(onInput).toHaveBeenCalledWith("not-yet-echoed edit");
  required(root(dialog).querySelector<HTMLButtonElement>(".actions button:last-child")).click();
  expect(onRespond).toHaveBeenCalledOnce();
});

it("renders a translated complete device-code message safely with the original LTR code", async () => {
  releaseCatalog = localization.registerCatalog({ id: "auth-test", namespace: "core.auth", locale: "de", load: () => Promise.resolve({
    enterCode: "<codeTag>{code}</codeTag> eingeben", loginProvider: "Bei {provider} anmelden",
  }) });
  const dialog = await mount({ step: "oauth", target: { machineId: "local" }, flow: { flowId: "flow", providerId: "provider", providerName: "User provider", status: "running", progress: [],
    auth: { url: "https://provider.test", deviceCode: { userCode: "<b>AB-123</b>" } },
  } });
  await language(dialog, "de");
  const code = required(root(dialog).querySelector("code"));
  expect(code.textContent).toBe("<b>AB-123</b>");
  expect(code.dir).toBe("ltr");
  expect(code.querySelector("b")).toBeNull();
  expect(required(code.parentElement).textContent).toBe("<b>AB-123</b> eingeben");
  expect(required(root(dialog).querySelector("strong")).textContent).toBe("Bei User provider anmelden");
});

it("keeps MCP starting titles semantic and updates every dialog step without rebuilding the flow", async () => {
  const states: AuthDialogState[] = [
    { step: "method", target: { machineId: "local" } },
    { step: "starting", target: { machineId: "local" }, mode: "logout" , title: "MCP authentication", mcpSession: { id: "s", cwd: "/repo" }},
    { step: "logout", target: { machineId: "local" }, providers: [] },
    { step: "oauth", target: { machineId: "local" }, flow: { flowId: "flow", providerId: "mcp", providerName: "User server", target: "mcp", mcpMode: "logout", status: "cancelled", progress: [] } },
  ];
  for (const state of states) {
    await localization.setPreferences({ language: "en", formatLocale: "en" });
    const dialog = await mount(state);
    const original = required(root(dialog).querySelector("strong")).textContent;
    await language(dialog, "ar-XB");
    expect(required(root(dialog).querySelector("strong")).textContent).not.toBe(original);
    expect(dialog.state).toBe(state);
    if (state.step === "oauth") {
      expect(required(root(dialog).querySelector("[role='alert']")).textContent).toBe(authMessages.t("cancelled"));
      expect(root(dialog).textContent).toContain(authMessages.t("logoutWarning"));
    }
    dialog.remove();
  }
});

it("releases its locale listener when disconnected and refreshes on reconnection", async () => {
  const dialog = await mount({ step: "method", target: { machineId: "local" } });
  dialog.remove();
  const requestUpdate = vi.spyOn(dialog, "requestUpdate");
  await language(dialog, "ar-XB");
  expect(requestUpdate).not.toHaveBeenCalled();
  document.body.append(dialog);
  await settle(dialog);
  expect(required(root(dialog).querySelector("strong")).textContent).toBe(authMessages.t("methodTitle"));
});
