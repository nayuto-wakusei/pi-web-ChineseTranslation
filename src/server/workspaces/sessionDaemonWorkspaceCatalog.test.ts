import { describe, expect, it } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import { SessionDaemonWorkspaceCatalog } from "./sessionDaemonWorkspaceCatalog.js";
import type { PiWebPluginCatalogDiagnosticCode } from "../piWebPluginCatalog.js";

const context: ManagementEmbedContext = {
  user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
  projects: [{ id: "managed", name: "Managed" }],
};

describe("session daemon workspace catalog proxy", () => {
  const diagnosticCodes = ["invalid-package", "reserved-id", "duplicate-id", "required-plugin-config"] as const satisfies readonly PiWebPluginCatalogDiagnosticCode[];

  it.each(diagnosticCodes)("preserves %s diagnostics without rejecting active plugin runtimes", async (code) => {
    const diagnostic = { code, source: "/plugins/invalid", message: "Invalid plugin configuration", pluginId: "invalid" };
    const record = { pluginId: "git", source: "bundled", scope: "bundled", moduleRevision: "git-r1", settingsRevision: "settings-r1", machineSpecific: true, pairedRequestVersion: 1, state: "active" };
    const catalog = new SessionDaemonWorkspaceCatalog({
      request: (method, path) => {
        expect(method).toBe("GET");
        expect(path).toBe("/workspace-catalog/provider-runtime");
        return Promise.resolve({ statusCode: 200, headers: {}, body: JSON.stringify({ protocolVersion: 1, records: [record], health: [], diagnostics: [diagnostic] }) });
      },
    });

    await expect(catalog.providerRuntime()).resolves.toMatchObject({ records: [record], diagnostics: [diagnostic] });
  });

  it.each(["unknown-code", "", null, 1])("rejects unknown or malformed diagnostic code %s", async (code) => {
    const catalog = new SessionDaemonWorkspaceCatalog({
      request: () => Promise.resolve({ statusCode: 200, headers: {}, body: JSON.stringify({ protocolVersion: 1, records: [], health: [], diagnostics: [{ code, source: "/plugins/invalid", message: "Invalid plugin" }] }) }),
    });

    await expect(catalog.providerRuntime()).rejects.toThrow("provider runtime diagnostic 1 code is invalid");
  });

  it("forwards management context and Workbench handle on catalog GETs", async () => {
    let headers: Record<string, string> | undefined;
    const catalog = new SessionDaemonWorkspaceCatalog({
      request: (_method, path, _body, requestHeaders) => {
        expect(path).toBe("/workspace-catalog/projects/managed/workspaces");
        headers = requestHeaders;
        return Promise.resolve({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "folder",
            projectId: "managed",
            workspaces: [{ id: "main", projectId: "managed", path: "/managed", label: "Managed", isMain: true }],
            diagnostics: [],
          }),
        });
      },
    }, {
      enabled: true,
      projectRoot: "/managed",
      authenticate: () => Promise.resolve(context),
      resourceHandle: () => "opaque-workbench-handle",
    } satisfies ManagementEmbedRuntime);

    await expect(catalog.resolveProject("managed", { managementContext: context })).resolves.toMatchObject({ projectId: "managed" });
    expect(decodeManagementContext(headers?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(context);
    expect(headers?.[WORKBENCH_ACCESS_HANDLE_HEADER]).toBe("opaque-workbench-handle");
  });

  it("keeps paired plugin capability versions from the daemon runtime snapshot", async () => {
    const catalog = new SessionDaemonWorkspaceCatalog({
      request: () => Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          records: [{
            pluginId: "git",
            source: "bundled",
            scope: "bundled",
            moduleRevision: "git-r1",
            settingsRevision: "settings-r1",
            machineSpecific: false,
            pairedRequestVersion: 1,
            state: "active",
          }],
          health: [],
          diagnostics: [],
        }),
      }),
    });

    await expect(catalog.providerRuntime()).resolves.toMatchObject({
      records: [{ pluginId: "git", pairedRequestVersion: 1 }],
    });
  });
});
