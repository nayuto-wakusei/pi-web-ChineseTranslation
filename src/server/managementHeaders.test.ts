import { describe, expect, it, vi } from "vitest";
import { decodeManagementContext, managementHeaders, MANAGEMENT_EMBED_CONTEXT_HEADER, WORKBENCH_ACCESS_HANDLE_HEADER, type ManagementEmbedContext } from "./managementEmbed.js";

const context: ManagementEmbedContext = {
  user: { id: "user", rootUserId: "root", roles: [], permissions: [] },
  projects: [{ id: "project", name: "Project" }],
};

describe("management forwarding headers", () => {
  it.each([undefined, "opaque-handle"])("preserves context and optional handle %s", (handle) => {
    const resourceHandle = vi.fn(() => handle);
    const runtime = { enabled: true, projectRoot: "/managed", authenticate: () => Promise.resolve(context), resourceHandle };

    expect(managementHeaders(undefined, runtime)).toBeUndefined();
    expect(resourceHandle).not.toHaveBeenCalled();
    const headers = managementHeaders(context, runtime);
    expect(decodeManagementContext(headers?.[MANAGEMENT_EMBED_CONTEXT_HEADER])).toEqual(context);
    expect(headers?.[WORKBENCH_ACCESS_HANDLE_HEADER]).toBe(handle);
    expect(Object.keys(headers ?? {})).toHaveLength(handle === undefined ? 1 : 2);
    expect(resourceHandle).toHaveBeenCalledExactlyOnceWith(context);
  });

  it("forwards context when no runtime is provided", () => {
    expect(managementHeaders(context, undefined)).toEqual({
      [MANAGEMENT_EMBED_CONTEXT_HEADER]: Buffer.from(JSON.stringify(context), "utf8").toString("base64url"),
    });
  });
});
