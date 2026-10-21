import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiScope } from "./http";
import { openPairedPluginBackendChannel as openPluginBackendChannel, requestPairedPluginBackend as requestPluginBackend } from "./pluginBackends";
import type { PluginPeerChannel } from "../../../plugin-api";
import { PLUGIN_BACKEND_RESPONSE_BODY_MAX_BYTES } from "../../../shared/pluginBackendProtocol";
import { pairedPluginBackendRequestPath, pairedPluginBackendRequestUrl, requestPairedPluginBackend, type PluginBackendRequestTarget } from "./pluginBackends";

const target: PluginBackendRequestTarget = {
  pluginId: "board.tools",
  backendRevision: "server-r1",
  machineId: "remote / one",
  projectId: "project / one",
  workspaceId: "workspace #1",
};

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

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

describe("browser plugin backend helper", () => {
  it("routes v5 machine/project calls and sends an explicit matching scope", async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response("null", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const machineTarget: PluginBackendRequestTarget = { pluginId: target.pluginId, backendRevision: target.backendRevision, machineId: "local", scope: "machine" };
    const projectTarget: PluginBackendRequestTarget = { ...machineTarget, scope: "project", projectId: "p/a" };
    expect(pairedPluginBackendRequestPath(machineTarget, "list")).toBe("api/paired-plugin-backends/board.tools/list");
    expect(pairedPluginBackendRequestPath(projectTarget, "list")).toBe("api/paired-plugin-backends/board.tools/projects/p%2Fa/list");
    await requestPairedPluginBackend(projectTarget, "list", null);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ revision: "server-r1", input: null, scope: "project", projectId: "p/a" }));
    expect(() => pairedPluginBackendRequestPath({ ...projectTarget, scope: "machine" }, "list")).toThrow("scope");
  });
  it("builds package-paired routes with encoded dynamic segments", () => {
    expect(pairedPluginBackendRequestPath({ ...target, machineId: "local" }, "cards.summary")).toBe(
      "api/paired-plugin-backends/board.tools/projects/project%20%2F%20one/workspaces/workspace%20%231/cards.summary",
    );
    expect(pairedPluginBackendRequestPath(target, "cards.summary")).toBe(
      "api/machines/remote%20%2F%20one/paired-plugin-backends/board.tools/projects/project%20%2F%20one/workspaces/workspace%20%231/cards.summary",
    );
  });

  it("resolves the helper exactly once under a nested deployment base", () => {
    const resolutionOptions = {
      viteBaseUrl: "./",
      documentBaseUrl: "https://pi.example.test/test/ai/",
    };
    expect(pairedPluginBackendRequestUrl(target, "cards.summary", resolutionOptions)).toBe(
      "https://pi.example.test/test/ai/api/machines/remote%20%2F%20one/paired-plugin-backends/board.tools/projects/project%20%2F%20one/workspaces/workspace%20%231/cards.summary",
    );
  });

  it("sends the active backend revision and private JSON input through the selected machine", async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ counts: { open: 2 }, cursor: "next" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(requestPairedPluginBackend(target, "cards.summary", { cards: ["alpha", "beta"], includeClosed: false }, { signal: controller.signal })).resolves.toEqual({
      counts: { open: 2 },
      cursor: "next",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://pi.example.test/api/machines/remote%20%2F%20one/paired-plugin-backends/board.tools/projects/project%20%2F%20one/workspaces/workspace%20%231/cards.summary");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: "server-r1", input: { cards: ["alpha", "beta"], includeClosed: false } }),
      signal: controller.signal,
    });
  });

  it("sends paired requests only through the paired route", async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response("null", {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await requestPairedPluginBackend(target, "cards.summary", null);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://pi.example.test/api/machines/remote%20%2F%20one/paired-plugin-backends/board.tools/projects/project%20%2F%20one/workspaces/workspace%20%231/cards.summary",
    );
  });

  it("rejects invalid requests and attributed non-success responses consistently", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: "Server plugin board.tools does not expose this operation",
      code: "operation-unavailable",
    }), { status: 501, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestPairedPluginBackend(target, "cards.summary", null)).rejects.toThrow("does not expose this operation");
    await expect(requestPairedPluginBackend(target, "Invalid/Operation", null)).rejects.toThrow("operation must match");
    await expect(requestPairedPluginBackend(target, "cards.summary", { invalid: Number.NaN })).rejects.toThrow("finite JSON numbers");
    await expect(requestPairedPluginBackend({ ...target, backendRevision: "" }, "cards.summary", null)).rejects.toThrow("revision must be a non-empty string");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves an attributed caller cancellation instead of wrapping it as transport loss", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, rejectPromise) => {
      init?.signal?.addEventListener("abort", () => {
        const reason: unknown = init.signal?.reason;
        rejectPromise(reason instanceof Error ? reason : new Error("request aborted", { cause: reason }));
      }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = requestPairedPluginBackend(target, "cards.summary", null, { signal: controller.signal });

    controller.abort(new DOMException("Panel closed", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "Panel closed" });
  });

  it("cancels responses that exceed the bounded JSON wire contract", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("x".repeat(PLUGIN_BACKEND_RESPONSE_BODY_MAX_BYTES + 1), {
      status: 200,
      headers: { "content-length": String(PLUGIN_BACKEND_RESPONSE_BODY_MAX_BYTES + 1) },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestPairedPluginBackend(target, "cards.summary", null)).rejects.toThrow("response exceeds");
  });
});
