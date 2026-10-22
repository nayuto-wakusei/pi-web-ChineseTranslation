// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthDialogState } from "../appState";
import type { OAuthFlowState } from "../api";
import { setClientTranslations } from "../i18n";
import { AuthDialog } from "./AuthDialog";
import type { ModalSurface } from "./ModalSurface";
beforeEach(() => { setClientTranslations("en", {}); });
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

describe("provider authentication entry points", () => {
  it.each([
    { step: "method", target: { machineId: "local" } },
    { step: "logout", target: { machineId: "local" }, providers: [] },
  ] satisfies AuthDialogState[])("keeps the $step dialog separate from MCP actions", async (state) => {
    const dialog = await mountDialog(state);
    expect(dialog.shadowRoot?.textContent).not.toContain("MCP");
  });
});

describe("unified MCP authentication dialog", () => {
  it("keeps the authorization link and redirect input together in the modal", async () => {
    const onOAuthRespond = vi.fn();
    const dialog = await mountDialog(oauthState({ target: "mcp", auth: { url: "https://auth.example/authorize" }, prompt: { requestId: "redirect", message: "Paste the redirected URL", promptType: "text" } }), { onOAuthRespond });
    expect(dialogSection(dialog).getAttribute("aria-label")).toBe("MCP authentication");
    expect(oauthAuthorizationLink(dialog).getAttribute("href")).toBe("https://auth.example/authorize");
    expect(promptInput(dialog).getAttribute("type")).toBe("text");
    expect(dialog.shadowRoot?.textContent).toContain("Paste the redirected URL");
    expect(dialog.shadowRoot?.textContent).toContain("copy the full URL");
    oauthActionButton(dialog, "Submit").click();
    expect(onOAuthRespond).toHaveBeenCalledOnce();
  });

  it("uses shared selection controls and prevents repeat submissions while a response is pending", async () => {
    const onOAuthRespond = vi.fn();
    const dialog = await mountDialog(oauthState({ target: "mcp", select: oauthSelect("server", "alpha") }), { onOAuthRespond });
    requiredElement(oauthSelectButtons(dialog)[0], "MCP server choice").click();
    expect(onOAuthRespond).toHaveBeenCalledWith("server");
    dialog.state = { ...oauthState({ target: "mcp", select: oauthSelect("server", "alpha") }), responding: true };
    await settleDialog(dialog);
    expect(requiredElement(oauthSelectButtons(dialog)[0], "pending server choice").disabled).toBe(true);
    expect(oauthActionButton(dialog, "Cancel")).toBeDefined();
  });

  it("retains Pi's terminal messages without assuming command completion means signed in", async () => {
    const dialog = await mountDialog(oauthState({ target: "mcp", status: "complete", auth: { url: "https://auth.example/authorize" }, progress: ["No enabled MCP server uses OAuth."] }));
    expect(dialog.shadowRoot?.textContent).toContain("Operation finished");
    expect(dialog.shadowRoot?.textContent).toContain("No enabled MCP server uses OAuth.");
    expect(dialog.shadowRoot?.textContent).not.toContain("Login complete");
    expect(dialog.shadowRoot?.querySelector(".form a")).toBeNull();
    expect(oauthActionButton(dialog, "Close")).toBeDefined();
  });

  it("explains cancellation races and lets the user close without claiming Pi has stopped", async () => {
    const onCancel = vi.fn();
    const onOAuthCancel = vi.fn();
    const dialog = await mountDialog(oauthState({ target: "mcp", cancelRequested: true, prompt: { requestId: "redirect", message: "Paste URL", promptType: "manual_code" } }), { onCancel, onOAuthCancel });
    expect(dialog.shadowRoot?.textContent).toContain("Waiting for Pi to finish");
    expect(dialog.shadowRoot?.textContent).toContain("Credentials may have been saved");
    expect(dialog.shadowRoot?.querySelector("input")).toBeNull();
    oauthActionButton(dialog, "Close").click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onOAuthCancel).not.toHaveBeenCalled();
  });

  it("names the selected server and explains credential reuse without forcing browser authentication", async () => {
    const dialog = await mountDialog(oauthState({ target: "mcp", mcpMode: "login", providerName: "Budgeter", status: "complete", progress: ["Signed in to MCP server Budgeter."] }));
    expect(dialogSection(dialog).getAttribute("aria-label")).toBe("MCP Login: Budgeter");
    expect(dialog.shadowRoot?.textContent).toContain("No browser authorization was requested");
    expect(dialog.shadowRoot?.textContent).toContain("may have reused existing credentials");
    expect(dialog.shadowRoot?.querySelector("a")).toBeNull();
    dialog.state = oauthState({ target: "mcp", mcpMode: "logout", providerName: "Budgeter" });
    await settleDialog(dialog);
    expect(dialogSection(dialog).getAttribute("aria-label")).toBe("MCP Logout: Budgeter");
    expect(dialog.shadowRoot?.textContent).toContain("does not disable the server or revoke access");
  });

  it("renders startup failures inside the same modal", async () => {
    const onCancel = vi.fn();
    const dialog = await mountDialog({ step: "starting", target: { machineId: "local" }, mcpSession: { id: "session-1", cwd: "/repo" }, title: "Sign in to an MCP server", error: "MCP extension is disabled" }, { onCancel });
    expect(dialog.shadowRoot?.querySelector("[role=alert]")?.textContent).toContain("MCP extension is disabled");
    requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>(".ui-form-actions button"), "Close action").click();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

interface AuthDialogCallbacks {
  onChooseMethod?: (authType: "oauth" | "api_key") => void;
  onSelectProvider?: (providerId: string, authType: "oauth" | "api_key") => void;
  onLogoutProvider?: (providerId: string) => void;
  onOAuthInput?: (value: string) => void;
  onOAuthRespond?: (value?: string) => void;
  onOAuthCancel?: () => void;
  onCancel?: () => void;
}

async function mountDialog(state: AuthDialogState, callbacks: AuthDialogCallbacks = {}): Promise<AuthDialog> {
  const dialog = new AuthDialog();
  Object.assign(dialog, callbacks);
  dialog.state = state;
  document.body.append(dialog);
  await settleDialog(dialog);
  return dialog;
}

async function settleDialog(dialog: AuthDialog): Promise<void> {
  // Await the dialog, the nested modal-surface it renders, and one more dialog
  // cycle so any render scheduled from within updated() has settled.
  await dialog.updateComplete;
  await dialogSurface(dialog).updateComplete;
  await dialog.updateComplete;
}

function dialogSurface(dialog: AuthDialog): ModalSurface {
  return requiredElement(dialog.shadowRoot?.querySelector<ModalSurface>("modal-surface"), "auth-dialog modal-surface");
}

function dialogSection(dialog: AuthDialog): HTMLElement {
  return requiredElement(dialogSurface(dialog).shadowRoot?.querySelector("dialog"), "auth-dialog dialog");
}

function promptInput(dialog: AuthDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector("input"), "OAuth prompt input");
}

function oauthSelectButtons(dialog: AuthDialog): HTMLButtonElement[] {
  return [...(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>(".inline-options button") ?? [])];
}

function oauthAuthorizationLink(dialog: AuthDialog): HTMLAnchorElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLAnchorElement>(".form a[href]"), "OAuth authorization link");
}

function oauthActionButton(dialog: AuthDialog, label: string): HTMLButtonElement {
  const button = [...(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>(".actions button") ?? [])]
    .find((candidate) => candidate.textContent.trim() === label);
  return requiredElement(button, `OAuth ${label} button`);
}

function oauthState(flow: Partial<OAuthFlowState> = {}): Extract<AuthDialogState, { step: "oauth" }> {
  return {
    step: "oauth",
    target: { machineId: "machine-1", projectId: "project-1" },
    flow: { flowId: "flow-1", providerId: "anthropic", providerName: "Anthropic", status: "running", progress: [], ...flow },
  };
}

function oauthSelect(requestId: string, label: string): NonNullable<OAuthFlowState["select"]> {
  return { requestId, message: "Choose an account", options: [{ value: requestId, label }] };
}

function requiredElement<T extends Element>(element: T | null | undefined, description: string): T {
  if (element === null || element === undefined) throw new Error(`Expected ${description} to exist`);
  return element;
}
