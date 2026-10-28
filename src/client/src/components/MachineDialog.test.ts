// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineDialog, machineBaseUrlValidationMessage } from "./MachineDialog";
import { deepActiveElement, pressKey, requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("machine-dialog modal surface", () => {
  it("focuses the base URL input when opened", async () => {
    const dialog = await mountDialog();

    expect(deepActiveElement()).toBe(urlInput(dialog));
  });

  it("associates URL validation, field guidance, and submission errors with their controls", async () => {
    const dialog = await mountDialog();
    const url = urlInput(dialog);
    expect(url.getAttribute("aria-invalid")).toBe("false");
    expect(description(dialog, url)).toContain("http:// or https://");

    url.value = "https://user@devbox.local";
    url.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(description(dialog, url)).toContain("Do not include credentials");
    expect(dialog.shadowRoot?.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(true);

    url.value = "https://devbox.local";
    url.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);
    expect(url.getAttribute("aria-invalid")).toBe("false");
    expect(description(dialog, nameInput(dialog))).toContain("Only changes the name shown here. Leave blank to use the remote machine’s name.");
    const token = requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='token']"), "token input");
    expect(description(dialog, token)).toContain("without the “Bearer” prefix");

    const name = nameInput(dialog);
    name.value = " ";
    name.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    dialog.error = "Could not connect. Check the URL and token.";
    await settleRenderedDialog(dialog);
    expect(name.getAttribute("aria-invalid")).not.toBe("true");
    expect(dialog.shadowRoot?.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(false);
    const form = requiredElement(dialog.shadowRoot?.querySelector("form"), "machine form");
    expect(description(dialog, form)).toContain("Could not connect");
    expect(dialog.shadowRoot?.querySelector("header button")?.getAttribute("aria-label")).toBe("Close add machine");
  });

  it("submits a blank override instead of suggesting a name from the URL", async () => {
    const dialog = await mountDialog();
    const onSubmit = vi.fn();
    dialog.onSubmit = onSubmit;
    const url = urlInput(dialog);
    url.value = "https://devbox.local";
    url.dispatchEvent(new Event("input", { bubbles: true }));
    await settleRenderedDialog(dialog);
    expect(nameInput(dialog).value).toBe("");
    dialog.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleRenderedDialog(dialog);
    expect(onSubmit).toHaveBeenCalledWith({ name: "", baseUrl: "https://devbox.local" });
  });

  it("prefills only the local override and lets it be cleared", async () => {
    const dialog = new MachineDialog();
    dialog.machine = { id: "remote", name: "My alias", nameOverride: "My alias", kind: "remote", baseUrl: "https://remote.test", createdAt: "", updatedAt: "" };
    const onSubmit = vi.fn();
    dialog.onSubmit = onSubmit;
    document.body.append(dialog);
    await settleRenderedDialog(dialog);
    expect(deepActiveElement()).toBe(nameInput(dialog));
    expect(nameInput(dialog).value).toBe("My alias");
    expect(nameInput(dialog).closest("label")?.textContent).toContain("Local display name");
    expect(dialog.shadowRoot?.querySelector(".ui-dialog-title")?.textContent).toBe("Edit local display name");
    nameInput(dialog).value = " ";
    nameInput(dialog).dispatchEvent(new Event("input", { bubbles: true }));
    dialog.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleRenderedDialog(dialog);
    expect(onSubmit).toHaveBeenCalledWith({ name: "", baseUrl: "https://remote.test" });
    dialog.machine = { id: "remote", name: "Reported name", kind: "remote", baseUrl: "https://remote.test", createdAt: "", updatedAt: "" };
    await settleRenderedDialog(dialog);
    expect(nameInput(dialog).value).toBe("");
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn<() => void>();
    const dialog = await mountDialog({ onCancel });

    pressKey(urlInput(dialog), "Escape");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("moves focus to the machine name on Enter in a valid base URL", async () => {
    const dialog = await mountDialog();
    const url = urlInput(dialog);
    url.value = "http://devbox.local:8504";
    url.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);

    pressKey(url, "Enter");
    await settleRenderedDialog(dialog);

    expect(deepActiveElement()).toBe(nameInput(dialog));
  });
});

async function mountDialog(props: { onCancel?: () => void } = {}): Promise<MachineDialog> {
  const dialog = new MachineDialog();
  if (props.onCancel !== undefined) dialog.onCancel = props.onCancel;
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function description(dialog: MachineDialog, control: Element): string {
  const id = control.getAttribute("aria-describedby");
  if (id === null) throw new Error("Expected description id");
  return requiredElement(dialog.shadowRoot?.getElementById(id), "field description").textContent;
}

function urlInput(dialog: MachineDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='baseUrl']"), "machine-dialog base URL input");
}

function nameInput(dialog: MachineDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='name']"), "machine-dialog name input");
}

describe("machineBaseUrlValidationMessage", () => {
  it("accepts http and https base URLs", () => {
    expect(machineBaseUrlValidationMessage("http://127.0.0.1:8504")).toBeUndefined();
    expect(machineBaseUrlValidationMessage("https://devbox.example.test/pi-web")).toBeUndefined();
  });

  it("explains invalid machine URLs", () => {
    expect(machineBaseUrlValidationMessage("")).toBe("Remote PI WEB URL is required.");
    expect(machineBaseUrlValidationMessage("devbox.local:8504")).toBe("Use an http:// or https:// URL.");
    expect(machineBaseUrlValidationMessage("ftp://devbox.example.test")).toBe("Use an http:// or https:// URL.");
    expect(machineBaseUrlValidationMessage("https://user@devbox.example.test")).toBe("Do not include credentials in the machine URL.");
    expect(machineBaseUrlValidationMessage("https://devbox.example.test?q=1")).toBe("Do not include a query string or fragment.");
  });
});
