import { describe, expect, it } from "vitest";
import { PLUGIN_BACKEND_RESOURCE_INPUT_MAX_BYTES, parsePluginBackendResourceQuery } from "../../../shared/pluginBackendProtocol";
import { pairedPluginBackendResourcePath, pairedPluginBackendResourceUrl, type PluginBackendRequestTarget } from "./pluginBackends";

const target: PluginBackendRequestTarget = {
  pluginId: "example.plugin",
  backendRevision: "revision / #é",
  machineId: "remote / #",
  scope: "machine",
};

const context = { viteBaseUrl: "./", documentBaseUrl: "https://pi.example.test/nested/app/" };

describe("browser plugin resource URLs", () => {
  it.each([
    { scope: "machine", suffix: "" },
    { scope: "project", projectId: "p / #", suffix: "/projects/p%20%2F%20%23" },
    { scope: "workspace", projectId: "p / #", workspaceId: "w / #", suffix: "/projects/p%20%2F%20%23/workspaces/w%20%2F%20%23" },
  ] as const)("builds and resolves $scope resource URLs under a nested base", ({ suffix, ...scope }) => {
    const selected = { ...target, ...scope };
    const input = { path: "image / #é.png", options: [true, null] };
    const path = pairedPluginBackendResourcePath(selected, "preview.image", input);
    expect(path.split("?")[0]).toBe(`api/machines/remote%20%2F%20%23/paired-plugin-backends/example.plugin${suffix}/resources/preview.image`);
    const url = new URL(pairedPluginBackendResourceUrl(selected, "preview.image", input, context));
    expect(url.href).toBe(`https://pi.example.test/nested/app/${path}`);
    expect(parsePluginBackendResourceQuery(Object.fromEntries(url.searchParams))).toEqual({ revision: target.backendRevision, input });
  });

  it("keeps local machine authority explicit and supports primitive JSON inputs", () => {
    expect(pairedPluginBackendResourcePath({ ...target, machineId: "local" }, "download", null)).toBe(
      "api/machines/local/paired-plugin-backends/example.plugin/resources/download?revision=revision+%2F+%23%C3%A9&input=null",
    );
  });

  it("enforces the UTF-8 JSON bound and rejects non-JSON values synchronously", () => {
    const exact = "é".repeat((PLUGIN_BACKEND_RESOURCE_INPUT_MAX_BYTES - 2) / 2);
    expect(() => pairedPluginBackendResourcePath(target, "image", exact)).not.toThrow();
    expect(() => pairedPluginBackendResourcePath(target, "image", `${exact}a`)).toThrow("byte limit");
    expect(() => pairedPluginBackendResourcePath(target, "image", Number.NaN)).toThrow();
    const cycle: Record<string, import("../../../shared/apiTypes").JsonValue> = {};
    cycle["self"] = cycle;
    expect(() => pairedPluginBackendResourcePath(target, "image", cycle)).toThrow("cycles");
  });

  it("rejects invalid operation, revision and scope authority", () => {
    expect(() => pairedPluginBackendResourcePath(target, "../image", null)).toThrow();
    expect(() => pairedPluginBackendResourcePath({ ...target, backendRevision: "" }, "image", null)).toThrow();
    expect(() => pairedPluginBackendResourcePath({ ...target, projectId: "p" }, "image", null)).toThrow("scope");
    expect(() => pairedPluginBackendResourcePath({ ...target, scope: "workspace", workspaceId: "w" }, "image", null)).toThrow("project");
  });
});
