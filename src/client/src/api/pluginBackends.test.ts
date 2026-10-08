import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiScope } from "./http";
import { openPluginBackendChannel, requestPluginBackend } from "./pluginBackends";
import type { PluginPeerChannel } from "../../../plugin-api";

afterEach(() => {
  setApiScope("normal");
  vi.unstubAllGlobals();
});

describe("plugin backend API scope", () => {
  it("exposes attributed server failures through the public peer channel close contract", async () => {
    vi.stubGlobal("location", { href: "https://pi.example.test/" });
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
    vi.stubGlobal("WebSocket", { CONNECTING: 0, OPEN: 1 });
    const events = new EventTarget();
    const close = vi.fn();
    const socket: WebSocket = {
      CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
      readyState: 1, bufferedAmount: 0, binaryType: "blob", extensions: "", protocol: "", url: "",
      onclose: null, onerror: null, onmessage: null, onopen: null,
      close, send: vi.fn(),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };
    const pending = openPluginBackendChannel({
      pluginId: "captains-log",
      backendRevision: "v1",
      machineId: "remote machine",
      projectId: "project",
      workspaceId: "main",
    }, "translate", {}, { onData: vi.fn() }, (url) => {
      expect(url).toBe("wss://pi.example.test/api/machines/remote%20machine/paired-plugin-backends/captains-log/projects/project/workspaces/main/channels/translate");
      return socket;
    });
    socket.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify({ version: 1, kind: "ready" }) }));
    const channel: PluginPeerChannel = await pending;
    socket.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify({ version: 1, kind: "error", code: "source-unavailable", message: "Source runtime stopped" }) }));
    expect(close).toHaveBeenCalledWith(1000, "Channel failed");
    socket.dispatchEvent(Object.assign(new Event("close"), { code: 1000, reason: "Channel failed", wasClean: true }));
    await expect(channel.closed).resolves.toEqual({
      code: 1000,
      reason: "Channel failed",
      wasClean: true,
      error: { code: "source-unavailable", message: "Source runtime stopped" },
    });
  });

  it("adds management embed parameters to backend requests", async () => {
    vi.stubGlobal("location", { href: "https://pi.example.test/?embed=management&token=launch-token" });
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
    setApiScope("management");
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ files: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await requestPluginBackend({
      pluginId: "git",
      backendRevision: "v1",
      machineId: "local",
      projectId: "managed",
      workspaceId: "main",
    }, "status", {});

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://pi.example.test/api/paired-plugin-backends/git/projects/managed/workspaces/main/status?embed=management&token=launch-token",
    );
  });
});
