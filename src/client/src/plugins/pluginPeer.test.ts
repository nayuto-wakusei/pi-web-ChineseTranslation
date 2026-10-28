import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../api";
import {
  createPluginPeer,
  createPluginBackend,
  type PluginPeerChannelOpener,
  type PluginPeerRequester,
} from "./pluginPeer";

const providerlessWorkspace: Workspace = {
  id: "workspace one",
  projectId: "project one",
  path: "/repo",
  label: "main",
  isMain: true,
  effectiveConfig: {},
};

const workspace: Workspace = {
  ...providerlessWorkspace,
  provider: {
    pluginId: "changes.owner",
    capabilities: { remove: false },
  },
};

describe("plugin peer", () => {
  it("exposes resource-only peers and preserves the captured revision and lifecycle", () => {
    const binding = { registrationPluginId: "remote.example", sourcePluginId: "example", backendRevision: "r1", pairedResourceVersion: 1 as const };
    const resourceUrl = vi.fn(() => "https://pi.test/resource");
    const lifetime = new AbortController();
    const backend = createPluginBackend(binding, "remote", lifetime.signal, vi.fn(), vi.fn(), resourceUrl);
    if (backend === undefined) throw new Error("Expected resource backend");
    const peer = backend.forScope({ kind: "project", projectId: "p1" });
    expect(Object.keys(peer)).toEqual(["resourceUrl"]);
    binding.backendRevision = "r2";
    binding.sourcePluginId = "other";
    expect(peer.resourceUrl?.("image", { path: "a.png" })).toBe("https://pi.test/resource");
    expect(resourceUrl).toHaveBeenCalledWith({ pluginId: "example", backendRevision: "r1", machineId: "remote", scope: "project", projectId: "p1" }, "image", { path: "a.png" });
    lifetime.abort(new Error("Plugin disposed"));
    expect(() => peer.resourceUrl?.("image", null)).toThrow("Plugin disposed");
    expect(() => backend.forScope({ kind: "machine" })).toThrow("Plugin disposed");
    expect(resourceUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { pairedResourceVersion: 1 as const },
    { pairedRequestVersion: 1 as const, pairedResourceVersion: 1 as const },
    { pairedChannelVersion: 1 as const, pairedResourceVersion: 1 as const },
    { pairedRequestVersion: 1 as const, pairedChannelVersion: 1 as const, pairedResourceVersion: 1 as const },
  ])("adds resources independently of request and channel support: %j", (capabilities) => {
    const resourceUrl = vi.fn(() => "https://pi.test/resource");
    const peer = createPluginPeer({ registrationPluginId: "example", sourcePluginId: "example", backendRevision: "r1", ...capabilities }, workspace, "local", vi.fn(), vi.fn(), resourceUrl);
    expect(peer?.resourceUrl?.("image", null)).toBe("https://pi.test/resource");
    expect(resourceUrl).toHaveBeenCalledWith({ pluginId: "example", backendRevision: "r1", machineId: "local", projectId: workspace.projectId, workspaceId: workspace.id }, "image", null);
    expect(typeof peer?.request === "function").toBe("pairedRequestVersion" in capabilities);
    expect(typeof peer?.openChannel === "function").toBe("pairedChannelVersion" in capabilities);
  });

  it("captures machine/package scope and cancels retained scoped peers on disposal", async () => {
    const lifetime = new AbortController();
    const request = vi.fn<PluginPeerRequester>(() => Promise.resolve(null));
    const backend = createPluginBackend({ registrationPluginId: "remote.plugin", sourcePluginId: "example.plugin", backendRevision: "r1", pairedRequestVersion: 1 }, "remote", lifetime.signal, request);
    if (backend === undefined) throw new Error("Expected backend");
    const machine = backend.forScope({ kind: "machine" });
    await machine.request?.("list", null);
    await backend.forScope({ kind: "project", projectId: "p1" }).request?.("list", null);
    await backend.forScope({ kind: "workspace", projectId: "p1", workspaceId: "w1" }).request?.("list", null);
    expect(request.mock.calls.map(([target]) => target)).toEqual([
      { pluginId: "example.plugin", backendRevision: "r1", machineId: "remote", scope: "machine" },
      { pluginId: "example.plugin", backendRevision: "r1", machineId: "remote", scope: "project", projectId: "p1" },
      { pluginId: "example.plugin", backendRevision: "r1", machineId: "remote", scope: "workspace", projectId: "p1", workspaceId: "w1" },
    ]);
    const signal = request.mock.calls[0]?.[3]?.signal;
    lifetime.abort();
    expect(signal?.aborted).toBe(true);
    expect(() => machine.request?.("list", null)).toThrow();
    expect(() => backend.forScope({ kind: "machine" })).toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("binds peer capabilities to the contribution source, revision, workspace, and machine", async () => {
    const request = vi.fn<PluginPeerRequester>(() => Promise.resolve({ files: [] }));
    const openChannel = vi.fn<PluginPeerChannelOpener>(() => Promise.resolve({
      closed: Promise.resolve({ code: 1000, reason: "done", wasClean: true }),
      send: vi.fn(),
      close: vi.fn(),
    }));
    const peer = createPluginPeer({
      registrationPluginId: "machine.remote.changes.owner",
      sourcePluginId: "changes.owner",
      backendRevision: "remote-r2",
      pairedRequestVersion: 1,
      pairedChannelVersion: 1,
    }, workspace, "remote one", request, openChannel);
    if (peer === undefined) throw new Error("Expected a plugin peer");

    const controller = new AbortController();
    expect(Object.keys(peer).sort()).toEqual(["openChannel", "request"]);
    await expect(peer.request?.("status", null, { signal: controller.signal })).resolves.toEqual({ files: [] });
    const channel = await peer.openChannel?.("watch", { cursor: 1 }, { signal: controller.signal, onData: vi.fn() });
    expect(channel).toHaveProperty("send");
    const target = {
      pluginId: "changes.owner",
      backendRevision: "remote-r2",
      machineId: "remote one",
      projectId: "project one",
      workspaceId: "workspace one",
    };
    expect(request).toHaveBeenCalledWith(target, "status", null, { signal: controller.signal });
    expect(openChannel).toHaveBeenCalledWith(target, "watch", { cursor: 1 }, expect.objectContaining({ signal: controller.signal }));
  });

  it("projects peer request and channel capabilities independently", () => {
    const requestOnly = createPluginPeer({
      registrationPluginId: "request-only",
      sourcePluginId: "request-only",
      backendRevision: "request-r1",
      pairedRequestVersion: 1,
    }, workspace, "local", vi.fn(), vi.fn());
    const channelOnly = createPluginPeer({
      registrationPluginId: "channel-only",
      sourcePluginId: "channel-only",
      backendRevision: "channel-r1",
      pairedChannelVersion: 1,
    }, workspace, "local", vi.fn(), vi.fn());

    expect(requestOnly).toHaveProperty("request");
    expect(requestOnly).not.toHaveProperty("openChannel");
    expect(channelOnly).toHaveProperty("openChannel");
    expect(channelOnly).not.toHaveProperty("request");
    expect(requestOnly).not.toHaveProperty("resourceUrl");
    expect(channelOnly).not.toHaveProperty("resourceUrl");
  });

  it("omits peer when the browser package advertises no peer capability", () => {
    const peer = createPluginPeer({
      registrationPluginId: "changes.owner",
      sourcePluginId: "changes.owner",
      backendRevision: "remote-r2",
    }, workspace, "remote-1", vi.fn(), vi.fn());

    expect(peer).toBeUndefined();
  });
});
