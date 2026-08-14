import { describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { eventScopeFromManagementContext, managementContextFromEventScope } from "./sessionEventScope.js";

describe("management session event scope", () => {
  it("retains the project topology needed by scoped status attribution", () => {
    const context: ManagementEmbedContext = {
      user: { id: "user-1", rootUserId: "root-1", roles: ["operator"], permissions: [] },
      projects: [{ id: "managed", name: "Managed project", role: "editor", root: "/managed/project" }],
      tools: { allow: ["terminal-command-runs"] },
    };

    expect(managementContextFromEventScope(eventScopeFromManagementContext(context))).toEqual(context);
  });
});
