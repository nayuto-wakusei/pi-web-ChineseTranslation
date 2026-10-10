// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, trustApi, type WorkspaceTrustResponse } from "../api";
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
    dialog.shadowRoot?.querySelector<HTMLButtonElement>("button.primary")?.click();
    expect(submit).toHaveBeenLastCalledWith("/repo", true, { trusted: false, changed: false });
    trustInput(dialog).click();
    await dialog.updateComplete;
    dialog.shadowRoot?.querySelector<HTMLButtonElement>("button.primary")?.click();
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
