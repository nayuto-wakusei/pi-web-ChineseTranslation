// @vitest-environment happy-dom
import { html, render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { captainStatusLabel, renderCaptainPanel, selectedSourceSession } from "../src/browser/panel.js";
import type { WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";

afterEach(() => { document.body.replaceChildren(); });

it("renders Chinese opt-in controls without submitting model work on render", () => {
  const onTranslate = vi.fn();
  render(renderCaptainPanel(html, {
    entries: [], status: "已连接", connected: true, connecting: false, pending: false,
    source: { id: "source", name: "测试会话" }, machineName: "测试机器",
    onTranslate, onReconnect: vi.fn(), onRead: vi.fn(), onOpenSource: vi.fn(),
  }), document.body);
  expect(document.body.textContent).toContain("船长日志");
  expect(document.body.textContent).toContain("可能产生费用");
  expect(onTranslate).not.toHaveBeenCalled();
  const action = [...document.querySelectorAll("button")].find((button) => button.textContent === "让船长转述");
  expect(action?.disabled).toBe(false);
  action?.click();
  expect(onTranslate).toHaveBeenCalledOnce();
});

it("rejects foreign, pending and archived source sessions without weakening public projection", () => {
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "本机", kind: "local" },
    workspace: { id: "w", projectId: "p", path: "/fixture", label: "fixture", isMain: true },
    state: { mainView: "workspace", selectedMachine: { id: "local", name: "本机", kind: "local" }, selectedSession: { id: "s", cwd: "/fixture", archived: false, pending: false } },
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    navigate: vi.fn(), host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null }, terminal: { open: vi.fn(), runCommand: vi.fn() },
  };
  expect(selectedSourceSession(context)).toEqual({ id: "s", name: "会话 s" });
  if (!context.state?.selectedSession) throw new Error("Expected selected session");
  expect(selectedSourceSession({ ...context, machine: { id: "remote", name: "远端", kind: "remote" } })).toBeUndefined();
  for (const patch of [{ pending: true }, { archived: true }, { cwd: "/elsewhere" }]) {
    expect(selectedSourceSession({ ...context, state: { ...context.state, selectedSession: { ...context.state.selectedSession, ...patch } } })).toBeUndefined();
  }
  expect(captainStatusLabel("interrupted")).toBe("已中断");
});
