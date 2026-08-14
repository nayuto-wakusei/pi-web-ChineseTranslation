import { describe, expect, it } from "vitest";
import { decodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext, type ManagementEmbedRuntime } from "../managementEmbed.js";
import { SessionDaemonWorkspaceCatalog } from "./sessionDaemonWorkspaceCatalog.js";

const context: ManagementEmbedContext = {
  user: { id: "user-1", rootUserId: "root-1", roles: [], permissions: [] },
  projects: [{ id: "managed", name: "Managed" }],
};

describe("session daemon workspace catalog proxy", () => {
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
});
