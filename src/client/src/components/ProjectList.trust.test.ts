// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, WorkspaceProviderResolution, WorkspaceTrustResponse } from "../api";
import { trustApi, workspacesApi } from "../api/clients";
import { setClientTranslations } from "../i18n";
import { installPopoverFake } from "./anchoredPopup.testSupport";
import { FolderProjectTrust } from "./FolderProjectTrust";
import { ProjectList } from "./ProjectList";

installPopoverFake();
const project: Project = { id: "p1", path: "/repo/plain", name: "plain", createdAt: "2026-10-26T00:00:00Z" };
const folder: WorkspaceProviderResolution = {
  projectId: project.id, status: "folder", diagnostics: [],
  workspaces: [{ id: "w1", projectId: project.id, path: project.path, label: project.name, isMain: true, effectiveConfig: {} }],
};
const untrusted: WorkspaceTrustResponse = { path: project.path, decision: false, trusted: false };

beforeEach(() => {
  setClientTranslations("en", {});
  vi.spyOn(workspacesApi, "workspaceResolution").mockResolvedValue(folder);
  vi.spyOn(trustApi, "workspaceTrust").mockResolvedValue(untrusted);
  vi.spyOn(trustApi, "setWorkspaceTrust").mockImplementation((_project, _workspace, trusted) => Promise.resolve({ ...untrusted, decision: trusted, trusted }));
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openMenu(managementMode = false): Promise<ProjectList> {
  const list = new ProjectList();
  list.projects = [project];
  list.machineId = "remote-a";
  list.managementMode = managementMode;
  list.onSelect = vi.fn();
  document.body.append(list);
  await list.updateComplete;
  find(list.shadowRoot, ".action-menu-toggle", HTMLButtonElement).click();
  await list.updateComplete;
  return list;
}

function entry(list: ProjectList): FolderProjectTrust {
  return find(list.shadowRoot, "folder-project-trust", FolderProjectTrust);
}

function checkbox(control: FolderProjectTrust): HTMLInputElement {
  return find(control.shadowRoot, "input", HTMLInputElement);
}

function find<T extends Element>(root: ParentNode | null, selector: string, type: new () => T): T {
  const result = root?.querySelector(selector);
  if (!(result instanceof type)) throw new Error(`Missing ${selector}`);
  return result;
}

async function ready(list: ProjectList): Promise<FolderProjectTrust> {
  const control = entry(list);
  await vi.waitFor(() => { expect(checkbox(control).disabled).toBe(false); });
  return control;
}

describe("folder project menu trust", () => {
  it("loads and toggles trust on the menu's machine without selecting or closing the project", async () => {
    const list = await openMenu();
    const control = await ready(list);
    expect(workspacesApi.workspaceResolution).toHaveBeenCalledWith("p1", "remote-a");
    expect(trustApi.workspaceTrust).toHaveBeenCalledWith("p1", "w1", "remote-a");
    expect(checkbox(control).checked).toBe(false);
    checkbox(control).click();
    await control.updateComplete;
    await vi.waitFor(() => { expect(checkbox(control).disabled).toBe(false); });
    expect(trustApi.setWorkspaceTrust).toHaveBeenLastCalledWith("p1", "w1", true, "remote-a");
    expect(checkbox(control).checked).toBe(true);
    checkbox(control).click();
    await control.updateComplete;
    await vi.waitFor(() => { expect(checkbox(control).disabled).toBe(false); });
    expect(checkbox(control).checked).toBe(false);
    expect(trustApi.setWorkspaceTrust).toHaveBeenLastCalledWith("p1", "w1", false, "remote-a");
    expect(list.onSelect).not.toHaveBeenCalled();
    expect(entry(list)).toBe(control);
  });

  it("disables repeated writes while saving, then rolls back and shows a failure", async () => {
    let rejectSave!: (error: Error) => void;
    vi.mocked(trustApi.setWorkspaceTrust).mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));
    const control = await ready(await openMenu());
    checkbox(control).click();
    await control.updateComplete;
    expect(checkbox(control).disabled).toBe(true);
    checkbox(control).click();
    expect(trustApi.setWorkspaceTrust).toHaveBeenCalledTimes(1);
    rejectSave(new Error("Permission denied"));
    await vi.waitFor(() => { expect(checkbox(control).disabled).toBe(false); });
    expect(checkbox(control).checked).toBe(false);
    expect(find(control.shadowRoot, "[role=alert]", HTMLElement).textContent).toBe("Permission denied");
    expect(checkbox(control).getAttribute("aria-describedby")).toContain("trust-error");
  });

  it.each(["provider", "degraded"] as const)("does not offer folder trust for %s resolutions", async (status) => {
    vi.mocked(workspacesApi.workspaceResolution).mockResolvedValue({ ...folder, status });
    const control = entry(await openMenu());
    await control.updateComplete;
    expect(control.shadowRoot?.querySelector("input")).toBeNull();
    expect(trustApi.workspaceTrust).not.toHaveBeenCalled();
  });

  it("does not query or render ordinary trust in management mode", async () => {
    const list = await openMenu(true);
    expect(list.shadowRoot?.querySelector("folder-project-trust")).toBeNull();
    expect(workspacesApi.workspaceResolution).not.toHaveBeenCalled();
    expect(trustApi.workspaceTrust).not.toHaveBeenCalled();
  });

  it.each(["catalog", "trust"])("fails closed and permits reopening after a %s read failure", async (stage) => {
    if (stage === "catalog") vi.mocked(workspacesApi.workspaceResolution).mockRejectedValueOnce(new Error("Read failed"));
    else vi.mocked(trustApi.workspaceTrust).mockRejectedValueOnce(new Error("Read failed"));
    const list = await openMenu();
    const control = entry(list);
    await vi.waitFor(() => { expect(find(control.shadowRoot, "[role=alert]", HTMLElement).textContent).toBe("Read failed"); });
    expect(control.shadowRoot?.querySelector<HTMLInputElement>("input")?.disabled ?? true).toBe(true);
    expect(trustApi.setWorkspaceTrust).not.toHaveBeenCalled();
    const toggle = find(list.shadowRoot, ".action-menu-toggle", HTMLButtonElement);
    toggle.click();
    await list.updateComplete;
    toggle.click();
    await list.updateComplete;
    expect(checkbox(await ready(list)).checked).toBe(false);
  });

  it("ignores a late trust read after switching machines with identical resource IDs", async () => {
    let resolveRead!: (response: WorkspaceTrustResponse) => void;
    vi.mocked(trustApi.workspaceTrust).mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const list = await openMenu();
    await vi.waitFor(() => { expect(trustApi.workspaceTrust).toHaveBeenCalledTimes(1); });
    list.machineId = "remote-b";
    await list.updateComplete;
    const control = await ready(list);
    resolveRead({ ...untrusted, trusted: true });
    await control.updateComplete;
    expect(checkbox(control).checked).toBe(false);
    checkbox(control).click();
    await control.updateComplete;
    expect(trustApi.setWorkspaceTrust).toHaveBeenCalledWith("p1", "w1", true, "remote-b");
  });

  it("ignores a late save after closing and reopening the menu", async () => {
    let resolveSave!: (response: WorkspaceTrustResponse) => void;
    vi.mocked(trustApi.setWorkspaceTrust).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    const list = await openMenu();
    checkbox(await ready(list)).click();
    const toggle = find(list.shadowRoot, ".action-menu-toggle", HTMLButtonElement);
    toggle.click();
    await list.updateComplete;
    toggle.click();
    await list.updateComplete;
    const control = await ready(list);
    resolveSave({ ...untrusted, trusted: true });
    await control.updateComplete;
    expect(checkbox(control).checked).toBe(false);
  });
});
