import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiScope } from "./http";
import { requestPluginBackend } from "./pluginBackends";

afterEach(() => {
  setApiScope("normal");
  vi.unstubAllGlobals();
});

describe("plugin backend API scope", () => {
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
      "https://pi.example.test/api/plugin-backends/git/projects/managed/workspaces/main/status?embed=management&token=launch-token",
    );
  });
});
