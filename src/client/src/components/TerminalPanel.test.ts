import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TerminalPanel resource lifecycle", () => {
  it("releases listeners, observers, polling, socket, and terminal resources on disconnect", () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const themeObserver = observer();
    const intersectionObserver = observer();
    const resizeObserver = observer();
    const clearInterval = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem: () => undefined },
      matchMedia: () => media,
      clearInterval,
    });

    const panel = new TerminalPanel();
    const socket = { close: vi.fn() };
    const terminal = { dispose: vi.fn() };
    Reflect.set(panel, "softKeysDefaultEnvironmentMedia", media);
    Reflect.set(panel, "themeObserver", themeObserver);
    Reflect.set(panel, "intersectionObserver", intersectionObserver);
    Reflect.set(panel, "resizeObserver", resizeObserver);
    Reflect.set(panel, "socket", socket);
    Reflect.set(panel, "terminal", terminal);
    Reflect.set(panel, "commandRunPollTimer", 7);

    panel.disconnectedCallback();

    expect(media.removeEventListener).toHaveBeenCalledOnce();
    expect(themeObserver.disconnect).toHaveBeenCalledOnce();
    expect(intersectionObserver.disconnect).toHaveBeenCalledOnce();
    expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
    expect(clearInterval).toHaveBeenCalledWith(7);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(terminal.dispose).toHaveBeenCalledOnce();
  });
});

function observer() {
  return { observe: vi.fn(), disconnect: vi.fn() };
}
