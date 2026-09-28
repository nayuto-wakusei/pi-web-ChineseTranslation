import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ServerPluginActivationContext, ServerPluginPeerRequestContext } from "@chainingintention/pi-web-cn/server-plugin-api";
import plugin from "./server-plugin.js";

describe("bundled Git server plugin", () => {
  it("activates server API v3 with a workspace provider and request peer", async () => {
    const activation = await plugin.activate(activationContext());

    expect(plugin.apiVersion).toBe(3);
    expect(activation.workspaceProvider).toEqual(expect.objectContaining({ fallback: true }));
    expect(activation.workspaceProvider).not.toHaveProperty("request");
    expect(activation.peer?.request).toEqual(expect.any(Function));
    expect(activation.peer).not.toHaveProperty("openChannel");
  });

  it("rejects an unknown peer operation before running Git", async () => {
    const execFile = vi.fn<ServerPluginActivationContext["execFile"]>();
    const activation = await plugin.activate(activationContext(execFile));
    const request = activation.peer?.request;
    if (request === undefined) throw new Error("Bundled Git did not activate its request peer");

    await expect(request(peerRequest("history"))).rejects.toThrow("Unsupported Git workspace backend operation");
    expect(execFile).not.toHaveBeenCalled();
  });
});

function activationContext(execFile: ServerPluginActivationContext["execFile"] = vi.fn()): ServerPluginActivationContext {
  return {
    apiVersion: 3,
    pluginId: "git",
    packageRoot: resolve("pi-web-plugins/git"),
    dataDirectory: "/data/plugin-data/git",
    logger: {
      debug() { /* no-op */ },
      info() { /* no-op */ },
      warn() { /* no-op */ },
      error() { /* no-op */ },
    },
    settings: {},
    execFile,
    signal: new AbortController().signal,
    lifetimeSignal: new AbortController().signal,
  };
}

function peerRequest(operation: string): ServerPluginPeerRequestContext {
  return {
    project: { id: "project-1", name: "Project", path: "/repo" },
    workspace: {
      id: "root",
      projectId: "project-1",
      path: "/repo",
      label: "main",
      isMain: true,
    },
    operation,
    input: null,
    signal: new AbortController().signal,
  };
}
