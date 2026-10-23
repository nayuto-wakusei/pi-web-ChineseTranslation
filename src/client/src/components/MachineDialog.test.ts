// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineDialog, machineBaseUrlValidationMessage, suggestedMachineNameFromUrl } from "./MachineDialog";
import { t } from "../i18n";
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
    expect(description(dialog, url)).toBe(t("ui.machineDialog.enterAnAccessibleBaseUrlIncludingHttpOr", "Enter an accessible base URL, including http:// or https://."));

    url.value = "https://user@devbox.local";
    url.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(description(dialog, url)).toBe(t("ui.machineDialog.doNotIncludeCredentialsInTheMachineUrl", "Do not include credentials in the machine URL."));
    expect(dialog.shadowRoot?.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(true);

    url.value = "https://devbox.local";
    url.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);
    expect(url.getAttribute("aria-invalid")).toBe("false");
    expect(description(dialog, nameInput(dialog))).toBe(t("ui.machineDialog.suggestedFromTheUrlChangeItToA", "Suggested from the URL. Change it to a friendly sidebar name."));
    const token = requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[name='token']"), "token input");
    expect(description(dialog, token)).toBe(t("ui.machineDialog.tokenWithoutPrefix", "If the remote machine requires a token, paste it without the “Bearer” prefix."));

    const name = nameInput(dialog);
    name.value = " ";
    name.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    dialog.error = "Could not connect. Check the URL and token.";
    await settleRenderedDialog(dialog);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(description(dialog, name)).toBe(t("ui.machineDialog.enterMachineName", "Enter a machine name."));
    const form = requiredElement(dialog.shadowRoot?.querySelector("form"), "machine form");
    expect(description(dialog, form)).toContain("Could not connect");
    expect(dialog.shadowRoot?.querySelector("header button")?.getAttribute("aria-label")).toBe(t("ui.machineDialog.closeAddMachine", "Close add machine"));
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

describe("suggestedMachineNameFromUrl", () => {
  it("suggests the host without protocol or port", () => {
    expect(suggestedMachineNameFromUrl("http://127.0.0.1:8504")).toBe("127.0.0.1");
    expect(suggestedMachineNameFromUrl("https://devbox.example.test:8504/pi-web")).toBe("devbox.example.test");
  });

  it("also suggests a host while the URL protocol is being typed", () => {
    expect(suggestedMachineNameFromUrl("devbox.local:8504")).toBe("devbox.local");
  });
});

describe("machineBaseUrlValidationMessage", () => {
  it("accepts http and https base URLs", () => {
    expect(machineBaseUrlValidationMessage("http://127.0.0.1:8504")).toBeUndefined();
    expect(machineBaseUrlValidationMessage("https://devbox.example.test/pi-web")).toBeUndefined();
  });

  it("explains invalid machine URLs", () => {
    expect(machineBaseUrlValidationMessage("")).toBe("必须填写远程 PI WEB URL。");
    expect(machineBaseUrlValidationMessage("devbox.local:8504")).toBe("请使用 http:// 或 https:// URL。");
    expect(machineBaseUrlValidationMessage("ftp://devbox.example.test")).toBe("请使用 http:// 或 https:// URL。");
    expect(machineBaseUrlValidationMessage("https://user@devbox.example.test")).toBe("机器 URL 中不要包含凭据。");
    expect(machineBaseUrlValidationMessage("https://devbox.example.test?q=1")).toBe("不要包含查询字符串或片段。");
  });
});
