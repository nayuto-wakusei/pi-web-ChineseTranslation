// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, trustApi, type WorkspaceTrustResponse } from "../api";
import type { ProjectTrustChoice } from "../controllers/projectController";
import { deepActiveElement, pressKey, requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";
import { ProjectDialog } from "./ProjectDialog";

beforeEach(() => {
  vi.spyOn(api, "projectDirectories").mockResolvedValue([]);
  vi.spyOn(trustApi, "projectTrust").mockImplementation((path) => Promise.resolve({ path, decision: null, trusted: false }));
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(): Promise<ProjectDialog> {
  const dialog = new ProjectDialog();
  document.body.append(dialog);
  await dialog.updateComplete;
  return dialog;
}

async function setPath(dialog: ProjectDialog, path: string): Promise<void> {
  const input = dialog.shadowRoot?.querySelector<HTMLInputElement>("input:not([type])");
  if (input === null || input === undefined) throw new Error("Path input missing");
  input.value = path;
  input.dispatchEvent(new InputEvent("input"));
  await dialog.updateComplete;
}

function trustInput(dialog: ProjectDialog): HTMLInputElement {
  const inputs = dialog.shadowRoot?.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  const input = inputs?.[1];
  if (input === undefined) throw new Error("Trust checkbox missing");
  return input;
}

describe("project trust choice", () => {
  it("does not write an untouched default, and forwards only an explicit toggle", async () => {
    const dialog = await mount();
    const submit = vi.fn();
    dialog.onSubmit = submit;
    await setPath(dialog, "/repo");
    await vi.waitFor(() => { expect(trustInput(dialog).disabled).toBe(false); });
    dialog.shadowRoot?.querySelector<HTMLButtonElement>("button.ui-button--primary")?.click();
    expect(submit).toHaveBeenLastCalledWith("/repo", true, { trusted: false, changed: false });
    trustInput(dialog).click();
    await dialog.updateComplete;
    dialog.shadowRoot?.querySelector<HTMLButtonElement>("button.ui-button--primary")?.click();
    expect(submit).toHaveBeenLastCalledWith("/repo", true, { trusted: true, changed: true });
  });

  it("drops an earlier path read and does not retain its trust checkbox", async () => {
    let resolveFirst!: (value: WorkspaceTrustResponse) => void;
    vi.mocked(trustApi.projectTrust).mockImplementation((path) => path === "/first"
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : Promise.resolve({ path, decision: false, trusted: false }));
    const dialog = await mount();
    await setPath(dialog, "/first");
    await setPath(dialog, "/second");
    await vi.waitFor(() => { expect(trustInput(dialog).disabled).toBe(false); });
    resolveFirst({ path: "/first", decision: true, trusted: true });
    await dialog.updateComplete;
    expect(trustInput(dialog).checked).toBe(false);
  });

  it("keeps management embed out of normal project trust", async () => {
    const dialog = await mount();
    dialog.managementMode = true;
    await dialog.updateComplete;
    await setPath(dialog, "/managed");
    expect(trustApi.projectTrust).not.toHaveBeenCalled();
    expect(dialog.shadowRoot?.querySelectorAll("input[type=checkbox]")).toHaveLength(1);
  });

  it("does not apply a pending read from another machine", async () => {
    let resolveOld!: (value: WorkspaceTrustResponse) => void;
    vi.mocked(trustApi.projectTrust).mockImplementation((path, machineId) => machineId === "local"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ path, decision: false, trusted: false }));
    const dialog = await mount();
    await setPath(dialog, "/repo");
    dialog.machineId = "remote-b";
    await dialog.updateComplete;
    await vi.waitFor(() => { expect(trustInput(dialog).disabled).toBe(false); });
    resolveOld({ path: "/repo", decision: true, trusted: true });
    await dialog.updateComplete;
    expect(trustInput(dialog).checked).toBe(false);
    expect(trustApi.projectTrust).toHaveBeenLastCalledWith("/repo", "remote-b");
  });
});

describe("project-dialog modal surface", () => {
  it("focuses the project path input when opened", async () => {
    const dialog = await mountDialog();

    expect(deepActiveElement()).toBe(pathInput(dialog));
  });

  // Regression proof for the pre-surface latent bug: the keydown listener lived
  // on the path input, so Escape with any other control focused did nothing.
  it("cancels on Escape from a control other than the path input", async () => {
    const onCancel = vi.fn<() => void>();
    const dialog = await mountDialog({ onCancel });
    const checkbox = createCheckbox(dialog);
    checkbox.focus();

    pressKey(checkbox, "Escape");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("submits the typed path on Enter in the path input", async () => {
    const onSubmit = vi.fn<(path: string, create: boolean, trust: ProjectTrustChoice | undefined) => void>();
    const dialog = await mountDialog({ onSubmit });
    const input = pathInput(dialog);
    input.value = "/work/new-project";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);
    await waitForTrustRead(dialog);

    pressKey(input, "Enter");

    expect(onSubmit).toHaveBeenCalledWith("/work/new-project", true, { trusted: false, changed: false });
  });

  it("disables the trust choice until a path is entered", async () => {
    const dialog = await mountDialog();

    expect(trustCheckbox(dialog).disabled).toBe(true);
  });

  it("prefills the trust choice with the existing decision for the entered path", async () => {
    const dialog = await mountDialog();
    vi.mocked(trustApi.projectTrust).mockResolvedValue({ path: "/work/proj", decision: true, trusted: true });
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await waitForTrustRead(dialog);

    expect(trustCheckbox(dialog).checked).toBe(true);
  });

  it("keeps an explicitly untrusted existing decision unchecked", async () => {
    const dialog = await mountDialog();
    vi.mocked(trustApi.projectTrust).mockResolvedValue({ path: "/work/proj", decision: false, trusted: false });
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await waitForTrustRead(dialog);

    expect(trustCheckbox(dialog).checked).toBe(false);
  });

  it("submits a flipped trust choice as a changed decision", async () => {
    const onSubmit = vi.fn<(path: string, create: boolean, trust: ProjectTrustChoice | undefined) => void>();
    const dialog = await mountDialog({ onSubmit });
    const input = pathInput(dialog);
    input.value = "/work/new-project";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await waitForTrustRead(dialog);
    const checkbox = trustCheckbox(dialog);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await settleRenderedDialog(dialog);

    pressKey(input, "Enter");

    expect(onSubmit).toHaveBeenCalledWith("/work/new-project", true, { trusted: true, changed: true });
  });

  // Regression: the suggestions and trust loaders used to share one staleness
  // counter, so the trust read fired on every keystroke discarded the in-flight
  // suggestions request and the loading hint never cleared.
  it("renders folder suggestions and clears the loading hint after typing a path", async () => {
    const dialog = await mountDialog();
    vi.mocked(api.projectDirectories).mockResolvedValue([{ path: "/work/proj/", kind: "other" }]);
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.querySelectorAll(".suggestions button").length).toBe(1);
    });
    await settleRenderedDialog(dialog);

    expect(dialog.shadowRoot?.querySelector(".suggestions button")?.textContent).toContain("/work/proj/");
    expect(dialog.shadowRoot?.textContent).not.toContain("正在加载文件夹…");
  });

  it("keeps showing folder suggestions while a slower trust read is still in flight", async () => {
    const dialog = await mountDialog();
    vi.mocked(api.projectDirectories).mockResolvedValue([{ path: "/work/proj/", kind: "other" }]);
    let resolveTrust: ((value: { path: string; decision: boolean | null; trusted: boolean }) => void) | undefined;
    vi.mocked(trustApi.projectTrust).mockReturnValue(new Promise((resolve) => { resolveTrust = resolve; }));
    const input = pathInput(dialog);
    input.value = "/work/proj";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

    await vi.waitFor(() => {
      expect(dialog.shadowRoot?.querySelectorAll(".suggestions button").length).toBe(1);
    });
    resolveTrust?.({ path: "/work/proj", decision: null, trusted: false });
    await settleRenderedDialog(dialog);

    expect(dialog.shadowRoot?.textContent).not.toContain("正在加载文件夹…");
  });

  it("explains what trusting a project means and links to the project-trust documentation", async () => {
    const dialog = await mountDialog();

    const hint = dialog.shadowRoot?.querySelector<HTMLElement>(".trust-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain(".pi 设置");
    expect(hint?.textContent).toContain("扩展");
    expect(hint?.textContent).toContain("技能");
    expect(hint?.textContent).toContain("包");
    // The explanation stays short and links to the docs instead of being verbose.
    const link = hint?.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href")).toBe("https://pi.dev/docs/latest/security");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(link?.textContent).toBe("了解项目信任");
  });
});

interface ProjectDialogProps {
  onSubmit?: (path: string, create: boolean, trust: ProjectTrustChoice | undefined) => void;
  onCancel?: () => void;
}

async function mountDialog(props: ProjectDialogProps = {}): Promise<ProjectDialog> {
  vi.spyOn(api, "projectDirectories").mockResolvedValue([]);
  vi.spyOn(trustApi, "projectTrust").mockResolvedValue({ path: "", decision: null, trusted: false });
  const dialog = new ProjectDialog();
  if (props.onSubmit !== undefined) dialog.onSubmit = props.onSubmit;
  if (props.onCancel !== undefined) dialog.onCancel = props.onCancel;
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

/** Waits until the trust read for the current path has resolved and rendered. */
async function waitForTrustRead(dialog: ProjectDialog): Promise<void> {
  await vi.waitFor(() => { expect(trustCheckbox(dialog).disabled).toBe(false); });
  await settleRenderedDialog(dialog);
}

function pathInput(dialog: ProjectDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("label input"), "project-dialog path input");
}

function createCheckbox(dialog: ProjectDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLInputElement>("input[type='checkbox']"), "project-dialog create checkbox");
}

/** The trust choice checkbox: the second of the two checkboxes the dialog renders. */
function trustCheckbox(dialog: ProjectDialog): HTMLInputElement {
  const checkbox = dialog.shadowRoot?.querySelectorAll<HTMLInputElement>("input[type='checkbox']")[1];
  return requiredElement(checkbox, "project-dialog trust checkbox");
}
