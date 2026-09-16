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

  it("adds controlled workbench tools without opening generic MCP or HTTP", () => {
    const context = managementContext({ tools: { allow: ["read", "python"], deny: ["python"] } });
    const extraTools = ["icnoc_search_capabilities", "icnoc_call_capability", "workbench_search_knowledge", "workbench_retrieve_knowledge", "workbench_retrieve_bookstack"];

    expect(managementAgentToolNames(context, extraTools)).toEqual(["read", ...extraTools]);
    expect(createManagementPermissionSystemPolicy(context, extraTools).tools).toMatchObject({
      icnoc_search_capabilities: "allow",
      icnoc_call_capability: "allow",
      workbench_search_knowledge: "allow",
      workbench_retrieve_knowledge: "allow",
      workbench_retrieve_bookstack: "allow",
      mcp: "deny",
      http: "deny",
      webfetch: "deny",
      python: "deny",
    });
  });

  it("keeps sandboxed Python available alongside controlled workbench tools", () => {
    const context = managementContext();
    const extraTools = ["icnoc_search_capabilities", "icnoc_call_capability", "workbench_search_knowledge", "workbench_retrieve_knowledge", "workbench_retrieve_bookstack"];

    expect(managementAgentToolNames(context, extraTools)).toEqual([
      "read",
      "write",
      "edit",
      "ls",
      "grep",
      "find",
      "python",
      ...extraTools,
    ]);
    expect(createManagementPermissionSystemPolicy(context, extraTools).tools).toMatchObject({
      python: "allow",
      bash: "deny",
      shell: "deny",
      terminal: "deny",
    });
  });

  it("allows registered delegation and ask-user tools while preserving explicit denies", () => {
    const controlledTools = [
      "spawn_session",
      "spawn_subsession",
      "list_subsessions",
      "check_subsession",
      "read_subsession",
      "yield_to_subsessions",
      "ask_user",
    ];
    const context = managementContext();

    expect(managementAgentToolNames(context, controlledTools)).toEqual([
      "read",
      "write",
      "edit",
      "ls",
      "grep",
      "find",
      "python",
      ...controlledTools,
    ]);
    expect(createManagementPermissionSystemPolicy(context, controlledTools).tools).toMatchObject({
      spawn_session: "allow",
      spawn_subsession: "allow",
      list_subsessions: "allow",
      check_subsession: "allow",
      read_subsession: "allow",
      yield_to_subsessions: "allow",
      ask_user: "allow",
      bash: "deny",
    });

    const deniedContext = managementContext({ tools: { deny: ["ask_user"] } });
    expect(managementAgentToolNames(deniedContext, controlledTools)).not.toContain("ask_user");
    expect(createManagementPermissionSystemPolicy(deniedContext, controlledTools).tools["ask_user"]).toBe("deny");
  });

  it("allows a privileged managed bash tool and HTTP without opening SDK shell, mcp, or terminals", () => {
    const context = managementContext({ privileged: { bash: true, network: true } });
    const privileges = { bash: true, network: true };
    const extraTools = ["bash", "http", "webfetch", "websearch"];

    expect(managementAgentToolNames(context, extraTools, privileges)).toEqual([
      "read",
      "write",
      "edit",
      "ls",
      "grep",
      "find",
      "python",
      ...extraTools,
    ]);
    expect(createManagementPermissionSystemPolicy(context, extraTools, privileges)).toMatchObject({
      defaultPolicy: { tools: "deny", bash: "deny", mcp: "deny", skills: "deny", special: "deny" },
      tools: {
        bash: "allow",
        python: "allow",
        http: "allow",
        webfetch: "allow",
        websearch: "allow",
        shell: "deny",
        powershell: "deny",
        pwsh: "deny",
        terminal: "deny",
        mcp: "deny",
      },
      bash: { "*": "deny" },
    });
  });

  it("lifts managed bash for a bash grant without enabling HTTP tools", () => {
    const context = managementContext({ privileged: { bash: true } });
    const privileges = { bash: true, network: false };
    const extraTools = ["bash", "http"];

    expect(managementAgentToolNames(context, extraTools, privileges)).toContain("bash");
    expect(managementAgentToolNames(context, extraTools, privileges)).not.toContain("http");
    expect(createManagementPermissionSystemPolicy(context, extraTools, privileges).tools).toMatchObject({
      bash: "allow",
      http: "deny",
      shell: "deny",
    });
  });

  it("lifts HTTP tools for a network grant without enabling bash", () => {
    const context = managementContext({ privileged: { network: true } });
    const privileges = { bash: false, network: true };
    const extraTools = ["bash", "http", "webfetch", "websearch"];

    expect(managementAgentToolNames(context, extraTools, privileges)).toEqual(expect.arrayContaining(["http", "webfetch", "websearch"]));
    expect(managementAgentToolNames(context, extraTools, privileges)).not.toContain("bash");
    expect(createManagementPermissionSystemPolicy(context, extraTools, privileges).tools).toMatchObject({
      bash: "deny",
      http: "allow",
      webfetch: "allow",
      websearch: "allow",
    });
  });

  it("keeps bash denied when an explicit deny accompanies a privileged grant", () => {
    const context = managementContext({ privileged: { bash: true }, tools: { deny: ["bash"] } });
    const privileges = { bash: false, network: false };

    expect(managementAgentToolNames(context, ["bash"], privileges)).not.toContain("bash");
    expect(createManagementPermissionSystemPolicy(context, ["bash"], privileges).tools["bash"]).toBe("deny");
  });
});

function managementContext(patch: Partial<ManagementEmbedContext> = {}): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
    ...patch,
  };
}
