import { describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { bubblewrapUnavailableReason, createBubblewrapPythonInvocation, createBubblewrapShellInvocation, createManagedPythonFallbackPrelude, createManagedSandboxEnvironment } from "./managementSandbox.js";

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
      "--ro-bind-try",
      "--bind",
      "/srv/pi/project",
      "/workspace",
      "python3",
      "-I",
      "-",
    ]));
    expect(invocation.args).not.toEqual(expect.arrayContaining(["--dev-bind", "/", "/"]));
  });

  it("builds a bubblewrap shell invocation for managed command runs", () => {
    const invocation = createBubblewrapShellInvocation({
      bubblewrapExecutable: "bwrap",
      shellExecutable: "/bin/bash",
      workspaceRoot: "/srv/pi/project",
      script: "cat /etc/ssh/ssh_host_rsa_key",
      env: { PATH: "/usr/bin:/bin", HOME: "/tmp/pi-web-home" },
      readOnlyPaths: ["/usr", "/bin"],
    });

    expect(invocation.command).toBe("bwrap");
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--unshare-net",
      "--clearenv",
      "--ro-bind-try",
      "--setenv",
      "HOME",
      "/tmp/pi-web-home",
      "--bind",
      "/srv/pi/project",
      "/workspace",
      "--chdir",
      "/workspace",
      "/bin/bash",
      "-lc",
      "cat /etc/ssh/ssh_host_rsa_key",
    ]));
    expect(invocation.args).not.toEqual(expect.arrayContaining(["--dev-bind", "/", "/"]));
    expect(invocation.args).not.toEqual(expect.arrayContaining(["--ro-bind-try", "/", "/"]));
  });

  it("omits network isolation when privileged network is enabled", () => {
    const python = createBubblewrapPythonInvocation({
      bubblewrapExecutable: "bwrap",
      pythonExecutable: "python3",
      workspaceRoot: "/srv/pi/project",
      network: true,
    });
    const shell = createBubblewrapShellInvocation({
      bubblewrapExecutable: "bwrap",
      shellExecutable: "/bin/bash",
      workspaceRoot: "/srv/pi/project",
      script: "curl https://example.test",
      network: true,
    });

    expect(python.args).not.toContain("--unshare-net");
    expect(shell.args).not.toContain("--unshare-net");
    expect(python.args).toEqual(expect.arrayContaining(["--unshare-pid", "--bind", "/srv/pi/project", "/workspace"]));
    expect(shell.args).toEqual(expect.arrayContaining(["--unshare-pid", "--bind", "/srv/pi/project", "/workspace"]));
  });

  it("makes the host filesystem read-only while keeping the workspace writable", () => {
    const invocation = createBubblewrapShellInvocation({
      bubblewrapExecutable: "bwrap",
      shellExecutable: "/bin/bash",
      workspaceRoot: "/srv/pi/project",
      script: "ls /other/project",
      hostFilesystem: true,
    });

    expect(invocation.args).toEqual(expect.arrayContaining([
      "--ro-bind-try",
      "/",
      "/",
      "--bind",
      "/srv/pi/project",
      "/workspace",
      "--bind",
      "/srv/pi/project",
      "/srv/pi/project",
      "--chdir",
      "/workspace",
    ]));
    expect(invocation.args).not.toEqual(expect.arrayContaining(["--dev-bind", "/", "/"]));
    const rootBind = invocation.args.indexOf("/");
    const workspaceBind = invocation.args.lastIndexOf("/workspace");
    expect(rootBind).toBeGreaterThan(-1);
    expect(workspaceBind).toBeGreaterThan(rootBind);
  });

  it("detects host bubblewrap permission failures that should fall back", () => {
    expect(bubblewrapUnavailableReason("bwrap: setting up uid map: Permission denied")).toBe("setting up uid map: Permission denied");
    expect(bubblewrapUnavailableReason("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted")).toBe("Failed RTM_NEWADDR: Operation not permitted");
    expect(bubblewrapUnavailableReason("Python exited with code 1")).toBeUndefined();
  });

  it("fallback prelude blocks common Python filesystem and process bypass APIs", () => {
    const prelude = createManagedPythonFallbackPrelude("/workspace");

    expect(prelude).toContain("builtins.open = open");
    expect(prelude).toContain("io.open = open");
    expect(prelude).toContain("pathlib.Path.open");
    expect(prelude).toContain("os.open = _pi_web_blocked_os_path");
    expect(prelude).toContain("subprocess.Popen = _pi_web_blocked_process");
  });
});

function managementContext(patch: Partial<ManagementEmbedContext> = {}): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
    ...patch,
  };
}
