// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProviderOption } from "../api";
import type { AuthDialogState } from "../appState";
import { AuthDialog } from "./AuthDialog";
import type { ModalSurface } from "./ModalSurface";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("auth-dialog provider search", () => {
  it("filters providers by name and id", async () => {
    const dialog = await mountDialog(providerState());

    await typeIntoSearch(dialog, "openai");

    expect(optionButtons(dialog)).toHaveLength(1);
    expect(optionButtons(dialog)[0]?.textContent).toContain("OpenAI");
  });

  it("activates the first filtered provider with Enter", async () => {
    const onSelectProvider = vi.fn<(providerId: string, authType: "oauth" | "api_key") => void>();
    const dialog = await mountDialog(providerState(), { onSelectProvider });

    await typeIntoSearch(dialog, "github");
    pressKey(searchInput(dialog), "Enter");

    expect(onSelectProvider).toHaveBeenCalledWith("github-copilot", "oauth");
  });

  it("shows an empty result and resets the query when the step changes", async () => {
    const dialog = await mountDialog(providerState());
    await typeIntoSearch(dialog, "missing");
    expect(optionButtons(dialog)).toHaveLength(0);
    expect(dialog.shadowRoot?.textContent).toContain("没有匹配的提供商");

    dialog.state = { step: "logout", target: target(), providers: providerOptions() };
    await settleDialog(dialog);

    expect(searchInput(dialog).value).toBe("");
    expect(optionButtons(dialog)).toHaveLength(2);
  });
});

async function mountDialog(state: AuthDialogState, callbacks: Partial<AuthDialog> = {}): Promise<AuthDialog> {
  const dialog = new AuthDialog();
  Object.assign(dialog, callbacks);
  dialog.state = state;
  document.body.append(dialog);
  await settleDialog(dialog);
  return dialog;
}

async function settleDialog(dialog: AuthDialog): Promise<void> {
  await dialog.updateComplete;
  await dialogSurface(dialog).updateComplete;
  await dialog.updateComplete;
}

function providerState(): Extract<AuthDialogState, { step: "providers" }> {
  return { step: "providers", mode: "login", target: target(), authType: "oauth", providers: providerOptions() };
}

function target() {
  return { machineId: "local", projectId: "project-1", projectName: "项目一" } as const;
}

function providerOptions(): AuthProviderOption[] {
  return [
    { id: "openai", name: "OpenAI", authType: "oauth", status: { configured: false } },
    { id: "github-copilot", name: "GitHub Copilot", authType: "oauth", status: { configured: false } },
  ];
}

function dialogSurface(dialog: AuthDialog): ModalSurface {
  return required(dialog.shadowRoot?.querySelector<ModalSurface>("modal-surface"));
}

function searchInput(dialog: AuthDialog): HTMLInputElement {
  return required(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[aria-label='搜索提供商']"));
}

function optionButtons(dialog: AuthDialog): HTMLButtonElement[] {
  return [...(dialog.shadowRoot?.querySelectorAll<HTMLButtonElement>(".options button") ?? [])];
}

async function typeIntoSearch(dialog: AuthDialog, value: string): Promise<void> {
  const input = searchInput(dialog);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settleDialog(dialog);
}

function pressKey(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true }));
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected element to exist");
  return value;
}
