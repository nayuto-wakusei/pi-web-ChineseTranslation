import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createManagementPermissionSystemPolicy, managementAgentToolNames, writeManagementPermissionSystemPolicy } from "./managementPermissionSystem.js";

describe("management permission system", () => {
  it("allows only the managed tool set and denies shell, mcp, http, and terminal tools", () => {
    const context = managementContext({
      tools: {
        allow: ["read", "python", "bash", "mcp", "terminal-command-runs"],
        deny: ["write"],
      },
    });

    expect(managementAgentToolNames(context)).toEqual(["read", "python"]);

    const policy = createManagementPermissionSystemPolicy(context);
    expect(policy.defaultPolicy).toEqual({
      tools: "deny",
      bash: "deny",
      mcp: "deny",
      skills: "deny",
      special: "deny",
    });
    expect(policy.tools).toMatchObject({
      "*": "deny",
      read: "allow",
      python: "allow",
      write: "deny",
      bash: "deny",
      mcp: "deny",
      "terminal-command-runs": "deny",
      webfetch: "deny",
      websearch: "deny",
    });
    expect(policy.bash).toEqual({ "*": "deny" });
    expect(policy.mcp).toEqual({ "*": "deny" });
  });

  it("writes the permission policy under a cwd-scoped management agent directory", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-web-management-policy-"));
    const cwd = join(agentDir, "workspace");
    await mkdir(cwd);

    const policyAgentDir = await writeManagementPermissionSystemPolicy(agentDir, cwd, managementContext());
    const policy: unknown = JSON.parse(await readFile(join(policyAgentDir, "pi-permissions.jsonc"), "utf8"));

    expect(policyAgentDir).toContain(join("management-embed", "permission-system", "root-user"));
    expect(policy).toMatchObject({
      defaultPolicy: { tools: "deny", bash: "deny", mcp: "deny", skills: "deny", special: "deny" },
      tools: {
        read: "allow",
        write: "allow",
        edit: "allow",
        ls: "allow",
        grep: "allow",
        find: "allow",
        python: "allow",
        bash: "deny",
      },
    });
  });
});

function managementContext(patch: Partial<ManagementEmbedContext> = {}): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
    ...patch,
  };
}
