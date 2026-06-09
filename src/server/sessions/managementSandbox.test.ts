import { describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createBubblewrapPythonInvocation, createManagedSandboxEnvironment } from "./managementSandbox.js";

describe("management sandbox environment", () => {
  it("does not inherit host secrets into managed Python", () => {
    const env = createManagedSandboxEnvironment({
      hostEnv: {
        PATH: "/usr/bin",
        LANG: "en_US.UTF-8",
        OPENAI_API_KEY: "sk-host",
        PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN: "host-token",
      },
      context: managementContext(),
    });

    expect(env).toMatchObject({ PATH: "/usr/bin", LANG: "en_US.UTF-8" });
    expect(env["OPENAI_API_KEY"]).toBeUndefined();
    expect(env["PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN"]).toBeUndefined();
  });

  it("rejects explicit sandbox environment values that look sensitive", () => {
    expect(() => createManagedSandboxEnvironment({
      hostEnv: { PATH: "/usr/bin" },
      context: managementContext({ sandbox: { env: { MODEL_TOKEN: "secret" } } }),
    })).toThrow("Sensitive sandbox environment variable is not allowed: MODEL_TOKEN");
  });

  it("builds a bubblewrap Python invocation with workspace-only writable mounts", () => {
    const invocation = createBubblewrapPythonInvocation({
      bubblewrapExecutable: "bwrap",
      pythonExecutable: "python3",
      workspaceRoot: "/srv/pi/project",
    });

    expect(invocation.command).toBe("bwrap");
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--unshare-net",
      "--die-with-parent",
      "--bind",
      "/srv/pi/project",
      "/workspace",
      "python3",
      "-I",
      "-",
    ]));
    expect(invocation.args).not.toEqual(expect.arrayContaining(["--dev-bind", "/", "/"]));
  });
});

function managementContext(patch: Partial<ManagementEmbedContext> = {}): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
    ...patch,
  };
}
