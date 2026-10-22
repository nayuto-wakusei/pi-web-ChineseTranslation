// @vitest-environment happy-dom
import type { JsonValue, PluginPeer, WorkspacePanelContext, WorkspacePanelNavigationV1 } from "@chainingintention/pi-web-cn/plugin-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalBrowserRuntime } from "./TerminalBrowserRuntime";
import { InMemoryTerminalSelectionMemory } from "./terminalSelection";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("requested terminal reload lifecycle", () => {
it.each(["route", "memory"] as const)("bounds missing %s selection reloads in the real Lit lifecycle", async (source) => {
    const panel = createTerminalPanel();
    const memory = new InMemoryTerminalSelectionMemory();
    const runtime = new TerminalBrowserRuntime(memory);
    let listings = 0;
    const request = vi.fn((operation: string): Promise<JsonValue> => {
      if (operation !== "terminal.list") return Promise.resolve([]);
      listings += 1;
      // Cap the broken render loop without relying on wall-clock timing.
      if (listings > 6) return new Promise(() => undefined);
      return Promise.resolve([terminalInfo("terminal-live")]);
    });
    const context = terminalContext({
      peer: terminalPeer(request),
      navigation: { ...terminalNavigation(source === "route" ? "terminal-gone" : undefined), set: vi.fn(() => false) },
    });
    if (source === "memory") memory.rememberTerminal(runtime.selectionScope(context), "terminal-gone");
    panel.context = context;
    panel.runtime = runtime;
    Reflect.set(panel, "visible", true);
    document.body.append(panel);
    try {
      // Let completed requests and their resulting Lit updates settle, without
      // manually invoking lifecycle methods or asking the host to rerender.
      for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
      expect(listings).toBeLessThanOrEqual(2);
      expect(listings).toBeGreaterThanOrEqual(1);
    } finally {
      panel.remove();
      runtime.dispose();
    }
  });

it("backs off failed requested-terminal reloads and reconciles a fresh context", async () => {
    vi.useFakeTimers();
    const panel = createTerminalPanel();
    const runtime = new TerminalBrowserRuntime(new InMemoryTerminalSelectionMemory());
    let listings = 0;
    let offline = true;
    const request = vi.fn((operation: string): Promise<JsonValue> => {
      if (operation !== "terminal.list") return Promise.resolve([]);
      listings += 1;
      if (listings > 1 && offline) return Promise.reject(new Error("offline"));
      return Promise.resolve([terminalInfo("terminal-live")]);
    });
    const context = terminalContext({
      peer: terminalPeer(request),
      navigation: { ...terminalNavigation("terminal-gone"), set: vi.fn(() => false) },
    });
    panel.context = context;
    panel.runtime = runtime;
    Reflect.set(panel, "visible", true);
    document.body.append(panel);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(listings).toBe(2);
      for (const [delay, expected] of [[1_000, 3], [2_000, 4], [5_000, 5]] as const) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(listings).toBe(expected - 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(listings).toBe(expected);
      }
      offline = false;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(listings).toBe(6);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(listings).toBe(6);

      panel.context = terminalContext({
        peer: terminalPeer(request),
        navigation: terminalNavigation("terminal-gone"),
      });
      await panel.updateComplete;
      await panel.updateComplete;
      expect(Reflect.get(panel, "selectedId")).toBe("terminal-live");
      expect(listings).toBe(6);
    } finally {
      panel.remove();
      runtime.dispose();
    }
  });

it("reloads a missing requested terminal once instead of on every update", async () => {
    vi.useFakeTimers();
    const panel = createTerminalPanel();
    const memory = new InMemoryTerminalSelectionMemory();
    const runtime = new TerminalBrowserRuntime(memory);
    const request = vi.fn((operation: string): Promise<JsonValue> =>
      Promise.resolve(operation === "terminal.list" ? [terminalInfo("terminal-live")] : []));
    // The host rejects the fallback selection write, so the requested terminal stays
    // absent from the list and the reload reason never clears on its own.
    const context = terminalContext({
      peer: terminalPeer(request),
      navigation: { ...terminalNavigation("terminal-gone"), set: vi.fn(() => false) },
    });
    Reflect.set(panel, "context", context);
    Reflect.set(panel, "runtime", runtime);
    Reflect.set(panel, "visible", true);
    callPanelMethod(panel, "willUpdate");
    await callAsyncPanelMethod(panel, "loadTerminals");

    // A settled list writes terminals/commandRuns, which schedules another updated().
    for (let cycle = 0; cycle < 6; cycle += 1) {
      callPanelMethod(panel, "updated");
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(request.mock.calls.map(([operation]) => operation)).toEqual([
      "terminal.list", "terminal.list-runs",
      "terminal.list", "terminal.list-runs",
    ]);
    panel.disconnectedCallback();
  });

it("reloads once for a newly requested terminal and then applies its selection", async () => {
    vi.useFakeTimers();
    const panel = createTerminalPanel();
    const runtime = new TerminalBrowserRuntime(new InMemoryTerminalSelectionMemory());
    let listings = 0;
    const request = vi.fn((operation: string): Promise<JsonValue> => {
      if (operation !== "terminal.list") return Promise.resolve([]);
      listings += 1;
      // The terminal appears only after the panel refetches.
      return Promise.resolve(listings === 1 ? [] : [terminalInfo("terminal-live")]);
    });
    const setNavigation = vi.fn();
    const loadedContext = terminalContext({
      peer: terminalPeer(request),
      navigation: { ...terminalNavigation(), set: setNavigation },
    });
    Reflect.set(panel, "context", loadedContext);
    Reflect.set(panel, "runtime", runtime);
    Reflect.set(panel, "visible", true);
    callPanelMethod(panel, "willUpdate");
    await callAsyncPanelMethod(panel, "loadTerminals");
    callPanelMethod(panel, "updated");
    expect(request).toHaveBeenCalledTimes(2);

    // A navigation to a terminal the panel has not listed yet refetches exactly once.
    const routedContext = terminalContext({
      peer: terminalPeer(request),
      navigation: { ...terminalNavigation("terminal-live"), set: setNavigation },
    });
    Reflect.set(panel, "context", routedContext);
    callPanelMethod(panel, "willUpdate");
    for (let cycle = 0; cycle < 4; cycle += 1) {
      callPanelMethod(panel, "updated");
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(request.mock.calls.map(([operation]) => operation)).toEqual([
      "terminal.list", "terminal.list-runs",
      "terminal.list", "terminal.list-runs",
    ]);
    expect(Reflect.get(panel, "selectedId")).toBe("terminal-live");
    panel.disconnectedCallback();
  });
});

function createTerminalPanel(): TerminalPanel {
  if (customElements.get("test-terminal-panel") === undefined) customElements.define("test-terminal-panel", TerminalPanel);
  const element = document.createElement("test-terminal-panel");
  if (!(element instanceof TerminalPanel)) throw new Error("Expected TerminalPanel test element");
  return element;
}

function terminalContext(overrides: Partial<WorkspacePanelContext> = {}): WorkspacePanelContext {
  return {
    navigate: () => Promise.resolve(),
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true },
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    peer: terminalPeer(
      vi.fn(() => Promise.resolve([])),
      vi.fn(() => new Promise<never>(() => undefined)),
    ),
    host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: vi.fn(() => ""), getSelection: vi.fn(() => null) },
    terminal: { open: vi.fn(), runCommand: vi.fn() },
    navigation: terminalNavigation(),
    ...overrides,
  };
}

function terminalPeer(
  request: NonNullable<PluginPeer["request"]>,
  openChannel?: NonNullable<PluginPeer["openChannel"]>,
): PluginPeer {
  return {
    request,
    ...(openChannel === undefined ? {} : { openChannel }),
  };
}

function terminalNavigation(terminalId?: string, autoStartRequest?: string): WorkspacePanelNavigationV1 {
  return {
    version: 1,
    contributionId: "pi-web.terminal:workspace.terminal",
    query: {
      ...(terminalId === undefined ? {} : { terminal: terminalId }),
      ...(autoStartRequest === undefined ? {} : { start: autoStartRequest }),
    },
    set: vi.fn(),
  };
}

function terminalInfo(id: string): JsonValue & { id: string; cwd: string; name: string; createdAt: string; exited: boolean } {
  return { id, cwd: "/repo", name: id, createdAt: "now", exited: false };
}

function callPanelMethod(panel: TerminalPanel, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(panel, name);
  if (typeof method !== "function") throw new Error(`TerminalPanel.${name} is unavailable`);
  return Reflect.apply(method, panel, args);
}

async function callAsyncPanelMethod(panel: TerminalPanel, name: string, ...args: unknown[]): Promise<void> {
  await callPanelMethod(panel, name, ...args);
}
