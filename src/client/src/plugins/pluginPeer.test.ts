import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../api";
import { createPluginPeer, type PluginBackendRequester } from "./workspaceBackend";

const workspace: Workspace = {
  id: "workspace one",
  projectId: "project one",
  path: "/repo",
  label: "main",
  isMain: true,
  isGitRepo: true,
  isGitWorktree: false,
  effectiveConfig: {},
};

describe("plugin peer", () => {
  it("binds a request peer to the contribution source, revision, workspace, and machine", async () => {
    const request = vi.fn<PluginBackendRequester>(() => Promise.resolve({ files: [] }));
    const peer = createPluginPeer({
      registrationPluginId: "machine.remote.git",
      sourcePluginId: "git",
      backendRevision: "remote-r2",
      pairedRequestVersion: 1,
    }, workspace, "remote one", request);
    if (peer === undefined) throw new Error("Expected a plugin peer");

    const controller = new AbortController();
    expect(Object.keys(peer).sort()).toEqual(["request"]);
    if (peer.request === undefined) throw new Error("Expected a request peer");
    await expect(peer.request("status", null, { signal: controller.signal })).resolves.toEqual({ files: [] });
    expect(request).toHaveBeenCalledWith({
      pluginId: "git",
      backendRevision: "remote-r2",
      machineId: "remote one",
      projectId: "project one",
      workspaceId: "workspace one",
    }, "status", null, { signal: controller.signal });
  });

  it("omits the peer when only a backend revision is advertised", () => {
    const peer = createPluginPeer({
      registrationPluginId: "git",
      sourcePluginId: "git",
      backendRevision: "remote-r2",
    }, workspace, "local", vi.fn());

    expect(peer).toBeUndefined();
  });

  it("exposes only a channel when the paired channel version is advertised", () => {
    const peer = createPluginPeer({
      registrationPluginId: "git",
      sourcePluginId: "git",
      backendRevision: "remote-r2",
      pairedChannelVersion: 1,
    }, workspace, "local", vi.fn());

    expect(Object.keys(peer ?? {}).sort()).toEqual(["openChannel"]);
  });

  it("omits the peer when a paired request version has no backend revision", () => {
    const peer = createPluginPeer({
      registrationPluginId: "git",
      sourcePluginId: "git",
      pairedRequestVersion: 1,
    }, workspace, "local", vi.fn());

    expect(peer).toBeUndefined();
  });
});
