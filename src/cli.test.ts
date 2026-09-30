import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentCommandForChecks,
  commandWithVersionCheck,
  doctorExitCode,
  expectedRunningComponents,
  isCliEntrypoint,
  installedServiceProbeEnvironment,
  launchdRuntimeDetails,
  nodeVersionCheck,
  regularFileExists,
  serviceBackendForPlatform,
  sessionDaemonRestartPlan,
} from "./cli.js";

const originalShell = process.env["SHELL"];
const originalPiWebConfig = process.env["PI_WEB_CONFIG"];
const originalPiWebAgentCommand = process.env["PI_WEB_AGENT_COMMAND"];

afterEach(() => {
  if (originalShell === undefined) {
    delete process.env["SHELL"];
  } else {
    process.env["SHELL"] = originalShell;
  }
  if (originalPiWebConfig === undefined) {
    delete process.env["PI_WEB_CONFIG"];
  } else {
    process.env["PI_WEB_CONFIG"] = originalPiWebConfig;
  }
  if (originalPiWebAgentCommand === undefined) {
    delete process.env["PI_WEB_AGENT_COMMAND"];
  } else {
    process.env["PI_WEB_AGENT_COMMAND"] = originalPiWebAgentCommand;
  }
});

describe("commandWithVersionCheck", () => {
  it("emits a POSIX subshell group for bash", () => {
    process.env["SHELL"] = "/bin/bash";
    expect(commandWithVersionCheck("npm")).toBe("command -v 'npm' && ('npm' --version 2>&1 || true)");
  });

  it("emits a POSIX subshell group for zsh", () => {
    process.env["SHELL"] = "/bin/zsh";
    expect(commandWithVersionCheck("pi")).toBe("command -v 'pi' && ('pi' --version 2>&1 || true)");
  });

  it("uses fish begin/end grouping instead of a POSIX subshell", () => {
    process.env["SHELL"] = "/usr/local/bin/fish";
    const command = commandWithVersionCheck("npm");
    expect(command).toBe("command -v 'npm' && begin; 'npm' --version 2>&1 || true; end");
    expect(command).not.toContain("(");
  });

  it("shell-quotes command words", () => {
    process.env["SHELL"] = "/bin/bash";
    expect(commandWithVersionCheck("/tmp/agent's/acme-agent")).toBe("command -v '/tmp/agent'\\''s/acme-agent' && ('/tmp/agent'\\''s/acme-agent' --version 2>&1 || true)");
  });
});

describe("nodeVersionCheck", () => {
  it("checks the complete supported Node version with the resolved executable", () => {
    process.env["SHELL"] = "/bin/bash";

    const command = nodeVersionCheck();

    expect(command).toContain("22.19.0");
    expect(command).toContain("process.versions.node");
    expect(command).toContain("\"$pi_web_probe_executable\"");
  });
});

describe("agentCommandForChecks", () => {
  it("reads the configured agent command for doctor checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-cli-test-"));
    try {
      const configPath = join(dir, "config.json");
      writeFileSync(configPath, `${JSON.stringify({ agent: { command: "acme-agent", dir: "/opt/acme-agent/state" } })}\n`);
      process.env["PI_WEB_CONFIG"] = configPath;
      delete process.env["PI_WEB_AGENT_COMMAND"];

      expect(agentCommandForChecks()).toBe("acme-agent");
      expect(agentCommandForChecks({
        PI_WEB_CONFIG: configPath,
        PI_WEB_AGENT_COMMAND: "environment-agent",
        PI_WEB_AGENT_DIR: join(dir, "environment-agent-state"),
      })).toBe("environment-agent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("installed service probe configuration", () => {
  const backend = { kind: "systemd", label: "systemd" } as const;
  const ids = new Set(["web", "sessiond"] as const);
  function definitions(configPath?: string) {
    const environment = configPath === undefined ? "" : `Environment="PI_WEB_CONFIG=${configPath}"\n`;
    const contents = `[Service]\n${environment}ExecStart=/usr/bin/env "/bin/bash" -lc "exec true"\n`;
    return [
      { id: "web" as const, contents },
      { id: "sessiond" as const, contents },
    ];
  }

  it.each(["start", "restart", "doctor"] as const)("uses installed configuration for %s without mutating the caller", (purpose) => {
    const inspect = vi.fn(() => ({ ok: true as const, value: definitions("/managed/config with space.json") }));
    const caller = { PATH: "/bin", PI_WEB_SESSIOND_SOCKET: "/custom/sessiond.sock" };
    const result = installedServiceProbeEnvironment(backend, ids, caller, purpose, inspect);
    expect(result).toEqual({ ok: true, value: { ...caller, PI_WEB_CONFIG: "/managed/config with space.json" } });
    expect(inspect).toHaveBeenCalledWith(backend, ["web", "sessiond"], purpose);
    expect(caller).not.toHaveProperty("PI_WEB_CONFIG");
  });

  it("lets an explicit caller override bypass unreadable definitions", () => {
    const inspect = vi.fn(() => ({ ok: false as const, message: "unreadable" }));
    const caller = { PI_WEB_CONFIG: "/caller/config.json" };
    expect(installedServiceProbeEnvironment(backend, ids, caller, "start", inspect)).toEqual({ ok: true, value: caller });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("uses the installed default when the caller config is empty or inherited", () => {
    const inspect = () => ({ ok: true as const, value: definitions() });
    const caller: NodeJS.ProcessEnv = {};
    Object.setPrototypeOf(caller, { PI_WEB_CONFIG: "/inherited/config.json" });
    for (const env of [caller, { PI_WEB_CONFIG: "" }]) {
      expect(installedServiceProbeEnvironment(backend, ids, env, "doctor", inspect)).toEqual({ ok: true, value: { PI_WEB_CONFIG: "" } });
    }
  });

  it("preserves the caller context when no managed services are installed", () => {
    const inspect = vi.fn(() => ({ ok: false as const, message: "unused" }));
    const caller = { PATH: "/bin" };
    expect(installedServiceProbeEnvironment(backend, new Set(), caller, "doctor", inspect)).toEqual({ ok: true, value: caller });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("rejects unreadable, relative, and mismatched installed configurations", () => {
    const mismatched = definitions("/a/config.json");
    mismatched[1] = { id: "sessiond", contents: definitions("/b/config.json")[1]?.contents ?? "" };
    for (const inspection of [
      { ok: false as const, message: "unreadable" },
      { ok: true as const, value: definitions("relative/config.json") },
      { ok: true as const, value: mismatched },
    ]) {
      expect(installedServiceProbeEnvironment(backend, ids, {}, "doctor", () => inspection).ok).toBe(false);
    }
  });

  it("selects an installed LaunchAgent configuration", () => {
    const contents = `<plist><dict><key>ProgramArguments</key><array><string>/usr/bin/env</string><string>/bin/zsh</string><string>-lc</string><string>exec true</string></array><key>EnvironmentVariables</key><dict><key>PI_WEB_CONFIG</key><string>/managed/config.json</string></dict></dict></plist>`;
    const result = installedServiceProbeEnvironment(
      { kind: "launchd", label: "LaunchAgents" }, ids, {}, "restart",
      () => ({ ok: true, value: [{ id: "web", contents }, { id: "sessiond", contents }] }),
    );
    expect(result).toEqual({ ok: true, value: { PI_WEB_CONFIG: "/managed/config.json" } });
  });
});

describe("native-service doctor CLI contracts", () => {
  it("uses native services only on supported platforms", () => {
    expect(serviceBackendForPlatform("linux")).toEqual({ kind: "systemd", label: "systemd user services" });
    expect(serviceBackendForPlatform("darwin")).toEqual({ kind: "launchd", label: "LaunchAgents" });
    expect(serviceBackendForPlatform("win32")).toBeUndefined();
  });

  it("fails doctor for general, native-plan, or node-pty failures", () => {
    expect(doctorExitCode(true, true, true, true)).toBe(0);
    expect(doctorExitCode(false, true, true, true)).toBe(1);
    expect(doctorExitCode(true, false, true, true)).toBe(1);
    expect(doctorExitCode(true, true, false, true)).toBe(1);
    expect(doctorExitCode(true, true, true, false)).toBe(1);
  });

  it("expects installed native components and both Docker components", () => {
    expect(expectedRunningComponents(new Set(["uiDev", "sessiond"]), {})).toEqual(["web", "sessiond"]);
    expect(expectedRunningComponents(new Set(), {})).toEqual([]);
    expect(expectedRunningComponents(new Set(), { PI_WEB_DOCKER_RUNTIME: "1" })).toEqual(["web", "sessiond"]);
  });

  it("accepts only regular files as bundled entrypoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-entrypoint-test-"));
    try {
      const file = join(dir, "entrypoint.js");
      writeFileSync(file, "export {};\n");
      expect(regularFileExists(file)).toBe(true);
      expect(regularFileExists(dir)).toBe(false);
      expect(regularFileExists(join(dir, "missing.js"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces launchd last exit code 127 in service status", () => {
    expect(launchdRuntimeDetails("state = exited\nlast exit code = 127\n")).toEqual({
      state: "exited",
      detail: "exited (last exit code 127)",
      pid: undefined,
    });
  });
});

describe("server plugin recovery restart planning", () => {
  it("uses the Docker control command inside development containers", () => {
    const runCommand = vi.fn();
    const plan = sessionDaemonRestartPlan({
      env: { PI_WEB_DOCKER_RUNTIME: "1", PI_WEB_DOCKER_MODE: "dev" },
      platform: "linux",
      runCommand,
    });

    expect(plan).toMatchObject({ kind: "automatic", command: "pi-web-docker --dev restart-sessiond" });
    plan.perform?.();
    expect(runCommand).toHaveBeenCalledWith("pi-web-docker", ["--dev", "restart-sessiond"]);
  });

  it("keeps explicit alternate config restarts manual", () => {
    const plan = sessionDaemonRestartPlan({
      env: { PI_WEB_DOCKER_RUNTIME: "1" },
      platform: "linux",
      configPath: "/tmp/alternate-pi-web.json",
      explicitConfigPath: true,
    });

    expect(plan.kind).toBe("manual");
    expect(plan.guidance).toContain('PI_WEB_CONFIG="/tmp/alternate-pi-web.json"');
  });
});

describe("isCliEntrypoint", () => {
  it("matches direct execution paths", () => {
    expect(isCliEntrypoint("/tmp/pi-web-cli.js", "/tmp/pi-web-cli.js")).toBe(true);
  });

  it("matches npm-style symlinked bin entrypoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-cli-test-"));
    try {
      const target = join(dir, "dist", "cli.js");
      const symlink = join(dir, "bin", "pi-web");
      mkdirSync(join(dir, "dist"));
      mkdirSync(join(dir, "bin"));
      writeFileSync(target, "#!/usr/bin/env node\n", { mode: 0o755 });
      symlinkSync(target, symlink);

      expect(isCliEntrypoint(symlink, target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not match unrelated paths", () => {
    expect(isCliEntrypoint("/tmp/pi-web", "/tmp/other-pi-web")).toBe(false);
  });
});
