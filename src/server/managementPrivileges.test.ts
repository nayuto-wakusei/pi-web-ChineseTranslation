import { describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "./managementEmbed.js";
import { DISABLED_MANAGEMENT_PRIVILEGES, managementPrivilegeRequested, managementPrivileges } from "./managementPrivileges.js";

describe("managementPrivileges", () => {
  it("stays disabled without a machine opt-in", () => {
    const context = privilegedContext({ bash: true, network: true });

    expect(managementPrivileges(context)).toEqual(DISABLED_MANAGEMENT_PRIVILEGES);
    expect(managementPrivileges(context, { allowPrivileged: false })).toEqual(DISABLED_MANAGEMENT_PRIVILEGES);
  });

  it("enables only the grants present on the signed context", () => {
    expect(managementPrivileges(privilegedContext({ bash: true }), { allowPrivileged: true })).toEqual({ bash: true, network: false });
    expect(managementPrivileges(privilegedContext({ network: true }), { allowPrivileged: true })).toEqual({ bash: false, network: true });
    expect(managementPrivileges(privilegedContext({ bash: true, network: true }), { allowPrivileged: true })).toEqual({ bash: true, network: true });
  });

  it("lets an explicit bash deny veto a privileged bash grant", () => {
    const context = privilegedContext({ bash: true, network: true }, { deny: ["bash"] });

    expect(managementPrivileges(context, { allowPrivileged: true })).toEqual({ bash: false, network: true });
  });

  it("does not treat a tools allow list as a privileged grant", () => {
    const context: ManagementEmbedContext = {
      ...privilegedContext(),
      tools: { allow: ["bash", "python"] },
    };

    expect(managementPrivileges(context, { allowPrivileged: true })).toEqual(DISABLED_MANAGEMENT_PRIVILEGES);
    expect(managementPrivilegeRequested(context)).toBe(false);
  });

  it("detects a requested grant even when the machine refuses it", () => {
    expect(managementPrivilegeRequested(privilegedContext({ bash: true }))).toBe(true);
    expect(managementPrivilegeRequested(privilegedContext())).toBe(false);
  });
});

function privilegedContext(
  privileged?: ManagementEmbedContext["privileged"],
  tools?: ManagementEmbedContext["tools"],
): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
    ...(privileged === undefined ? {} : { privileged }),
    ...(tools === undefined ? {} : { tools }),
  };
}
