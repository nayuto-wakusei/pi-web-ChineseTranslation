// @vitest-environment happy-dom
import type { TerminalCommandRun, WorkspacePanelTerminal } from "@chainingintention/pi-web-cn/plugin-api";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkspacePanelContext } from "../../src/testSupport/plugin";
import { defineTasksPanelElement, PiWebTasksPanel } from "./tasksPanelElement";

defineTasksPanelElement();
afterEach(() => { document.body.replaceChildren(); });

it("keeps task controls explicitly non-submitting inside an external form", async () => {
  const run: TerminalCommandRun = {
    id: "controls-run", origin: "workspace-tasks", projectId: "p1", workspaceId: "w1", terminalId: "terminal-1",
    title: "Build", command: "npm run build", status: "succeeded", createdAt: "now", metadata: {},
  };
  const runCommand = vi.fn<WorkspacePanelTerminal["runCommand"]>(() => Promise.resolve({ run, completed: Promise.resolve(run) }));
  const open = vi.fn();
  const context = createWorkspacePanelContext({ terminal: { open, runCommand } });
  const readFile = vi.fn(() => Promise.resolve({
    path: ".pi-web/tasks.json", content: JSON.stringify({ version: 1, tasks: [{ id: "build", title: "Build", command: "npm run build" }] }),
    encoding: "utf8" as const, truncated: false, binary: false, size: 0, modifiedAt: "now",
  }));
  context.files = { ...context.files, readFile };
  const form = document.createElement("form");
  const submit = vi.fn((event: Event) => { event.preventDefault(); });
  form.addEventListener("submit", submit);
  const panel = new PiWebTasksPanel();
  panel.context = context;
  form.append(panel);
  document.body.append(form);
  await vi.waitFor(() => { expect(panel.shadowRoot?.querySelector("[data-task-id]")).not.toBeNull(); });
  const buttons = [...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? []];
  expect(buttons).toHaveLength(3);
  expect(buttons.every((button) => button.getAttribute("type") === "button")).toBe(true);
  panel.shadowRoot?.querySelector<HTMLButtonElement>("[data-open-terminal]")?.click();
  expect(open).toHaveBeenCalledOnce();
  panel.shadowRoot?.querySelector<HTMLButtonElement>("[data-task-id]")?.click();
  await vi.waitFor(() => { expect(runCommand).toHaveBeenCalledOnce(); });
  panel.shadowRoot?.querySelector<HTMLButtonElement>("[data-refresh-config]")?.click();
  await vi.waitFor(() => { expect(readFile).toHaveBeenCalledTimes(2); });
  expect(submit).not.toHaveBeenCalled();
});
