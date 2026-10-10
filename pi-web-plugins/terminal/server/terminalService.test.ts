import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IPty, spawn } from "node-pty";
import type { ServerPluginNoticeInput } from "@chainingintention/pi-web-cn/server-plugin-api";
import { interactiveShellArgs, TerminalService, type TerminalActivitySink, type TerminalInfo, type TerminalWorkspaceScope } from "./terminalService";

describe("interactive shell arguments", () => {
  it.each([
    { shell: "bash", expected: ["-l"] },
    { shell: "/usr/local/bin/zsh", expected: ["-l"] },
    { shell: "/opt/homebrew/bin/fish", expected: ["-l"] },
    { shell: String.raw`C:\Program Files\Git\bin\bash.exe`, expected: ["-l"] },
    { shell: "/bin/dash", expected: [] },
    { shell: "pwsh", expected: [] },
    { shell: "powershell.exe", expected: [] },
    { shell: "cmd.exe", expected: [] },
  ])("uses login mode only for a supported shell: $shell", ({ shell, expected }) => {
    expect(interactiveShellArgs(shell)).toEqual(expected);
  });
});

describe("independent Terminal PTY lifecycle", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  function fixture(recordNotice?: (input: ServerPluginNoticeInput) => void) {
    let onExit: (event: { exitCode: number; signal?: number }) => void = () => undefined;
    const terminal = {
      pid: 1, cols: 100, rows: 30, process: "test", handleFlowControl: false,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn((listener: typeof onExit) => { onExit = listener; return { dispose: vi.fn() }; }),
      write: vi.fn(), resize: vi.fn(), kill: vi.fn(), clear: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    } satisfies IPty;
    const spawnPty = vi.fn<typeof spawn>(() => terminal);
    const service = new TerminalService(recordNotice, spawnPty);
    return { service, spawn: spawnPty, terminal, exit: (code: number) => { onExit({ exitCode: code }); } };
  }

  it("retains Windows PowerShell interactive and independently configured Bash command invocations", () => {
    vi.stubEnv("SHELL", "powershell.exe");
    vi.stubEnv("PI_WEB_COMMAND_SHELL", String.raw`D:\Program Files\Git\bin\bash.exe`);
    const { service, spawn, exit } = fixture();
    try {
      service.create(scope());
      expect(spawn).toHaveBeenLastCalledWith("powershell.exe", [], expect.objectContaining({
        cwd: process.cwd(),
      }));
      expect(spawn.mock.calls.at(-1)?.[2].env).toMatchObject({ PI_WEB_TERMINAL: "1" });
      const run = service.runCommand({ ...scope(), origin: "core", title: "Command", command: "true" });
      expect(spawn).toHaveBeenLastCalledWith(String.raw`D:\Program Files\Git\bin\bash.exe`,
        ["-lc", expect.stringContaining("true")], expect.objectContaining({ cwd: process.cwd() }));
      exit(0);
      service.continue(scope(), run.terminalId);
      expect(spawn).toHaveBeenLastCalledWith("powershell.exe", [], expect.objectContaining({ cwd: process.cwd() }));
    } finally { service.dispose(); }
  });

  it("uses the native interactive fallback but never runs command scripts in PowerShell", () => {
    vi.stubEnv("SHELL", undefined);
    vi.stubEnv("PI_WEB_COMMAND_SHELL", undefined);
    const { service, spawn } = fixture();
    try {
      service.create(scope());
      expect(spawn.mock.calls.at(-1)?.[0]).toBe(process.platform === "win32" ? "powershell.exe" : "/bin/bash");
      service.runCommand({ ...scope(), origin: "core", title: "Command", command: "true" });
      expect(spawn.mock.calls.at(-1)?.[0]).toMatch(/(?:^|[\\/])bash(?:\.exe)?$/);
    } finally { service.dispose(); }
  });

  it("rejects learned terminal ids in another workspace and disposal prevents new processes", () => {
    const { service, terminal } = fixture();
    const info = service.create(scope());
    const other = { ...scope(), workspaceId: "other" };
    expect(service.get(other, info.id)).toBeUndefined();
    expect(() => { service.write(other, info.id, "secret"); }).toThrow("此工作区中未找到终端");
    expect(terminal.write).not.toHaveBeenCalled();
    service.dispose();
    service.dispose();
    expect(terminal.kill).toHaveBeenCalledOnce();
    expect(() => service.create(scope())).toThrow("终端服务已停止");
  });

  it("binds activity once and reports scoped command failures without publishing private intent", () => {
    const notices: ServerPluginNoticeInput[] = [];
    const { service, spawn, exit } = fixture((input) => { notices.push(input); });
    const updateTerminal = vi.fn<TerminalActivitySink["updateTerminal"]>();
    const removeTerminal = vi.fn();
    service.bindActivitySink({ updateTerminal, removeTerminal });
    expect(() => { service.bindActivitySink({ updateTerminal, removeTerminal }); }).toThrow("已绑定");
    try {
      const run = service.runCommand({ ...scope(), origin: "core", title: "Failure", command: "exit 7",
        failureNotice: { message: "工作区移除失败。请查看终端输出。", context: { targetWorkspaceId: "target" } },
      });
      expect(run).not.toHaveProperty("failureNotice");
      exit(7);
      expect(service.getCommandRun(run.id)).toMatchObject({ status: "failed", exitCode: 7 });
      expect(updateTerminal.mock.calls.map(([info]) => info.exited)).toEqual([false, true]);
      service.close(scope(), run.terminalId);
      expect(removeTerminal).toHaveBeenCalledWith(run.terminalId, process.cwd());
      expect(spawn).toHaveBeenCalledOnce();
      expect(notices).toEqual([{
        severity: "error", message: "工作区移除失败。请查看终端输出。", scope: { projectId: "p1" },
        context: { targetWorkspaceId: "target", commandRunId: run.id },
      }]);
    } finally { service.dispose(); }
  });
});

// These integration cases require real POSIX shell commands and login profiles.
describe.skipIf(process.platform === "win32")("TerminalService command runs", () => {
  it("closes all terminal records for a cwd", () => {
    const service = new TerminalService();
    try {
      const terminal = service.create(scope());
      let closed = 0;
      service.attach(scope(), terminal.id, {
        output: () => undefined,
        exit: () => undefined,
        closed: () => { closed += 1; },
      });

      service.closeForCwd(process.cwd());

      expect(closed).toBe(1);
      expect(service.get(scope(), terminal.id)).toBeUndefined();
      expect(service.list(scope())).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  it("closes all terminals only in the requested workspace when cwd values match", () => {
    const service = new TerminalService();
    const firstScope = scope();
    const secondScope = { ...firstScope, projectId: "p2", workspaceId: "w2" };
    try {
      const first = service.create(firstScope);
      const second = service.create(secondScope);
      let firstClosed = 0;
      service.attach(firstScope, first.id, {
        output: () => undefined,
        exit: () => undefined,
        closed: () => { firstClosed += 1; },
      });

      service.closeAll(firstScope);

      expect(firstClosed).toBe(1);
      expect(service.get(firstScope, first.id)).toBeUndefined();
      expect(service.get(secondScope, second.id)).toMatchObject({ id: second.id, cwd: secondScope.cwd });
    } finally {
      service.dispose();
    }
  });

  it("loads login-profile PATH entries in new interactive terminals", async () => {
    await withBashLoginProfile(async () => {
      const service = new TerminalService();
      try {
        const terminal = service.create(scope());
        const exit = terminalExit(service, terminal.id);

        service.write(scope(), terminal.id, `${LOGIN_PROFILE_COMMAND}\nexit\n`);

        expect(await exit).toContain(LOGIN_PROFILE_OUTPUT);
      } finally {
        service.dispose();
      }
    });
  });

  it("loads login-profile PATH entries in continued interactive terminals", async () => {
    await withBashLoginProfile(async () => {
      const service = new TerminalService();
      try {
        const run = service.runCommand({
          origin: "core",
          projectId: "p1",
          workspaceId: "w1",
          cwd: process.cwd(),
          title: "Done command",
          command: "true",
        });
        await terminalExit(service, run.terminalId);

        service.continue(scope(), run.terminalId);
        const shellReady = firstLiveTerminalOutput(service, run.terminalId);
        const exit = terminalExit(service, run.terminalId);
        await shellReady;
        service.write(scope(), run.terminalId, `${LOGIN_PROFILE_COMMAND}\nexit\n`);

        expect(await exit).toContain(LOGIN_PROFILE_OUTPUT);
      } finally {
        service.dispose();
      }
    });
  });

  describe("PI_WEB_TERMINAL propagation", () => {
    let originalPiWebTerminal: string | undefined;

    beforeEach(() => {
      originalPiWebTerminal = process.env["PI_WEB_TERMINAL"];
      process.env["PI_WEB_TERMINAL"] = "conflicting-parent-value";
    });

    afterEach(() => {
      if (originalPiWebTerminal === undefined) {
        delete process.env["PI_WEB_TERMINAL"];
      } else {
        process.env["PI_WEB_TERMINAL"] = originalPiWebTerminal;
      }
    });

    it("sets PI_WEB_TERMINAL for terminal commands", async () => {
      const service = new TerminalService();
      try {
        const frame = "__PI_WEB_RUN_ENV_7F3A9C__";
        const run = service.runCommand({
          origin: "core",
          projectId: "p1",
          workspaceId: "w1",
          cwd: process.cwd(),
          title: "Environment check",
          command: `printf '${frame}%s${frame}\\n' "$PI_WEB_TERMINAL"`,
        });

        expect(await terminalExit(service, run.terminalId)).toContain(`${frame}1${frame}`);
      } finally {
        service.dispose();
      }
    });

    it("sets PI_WEB_TERMINAL in a continued interactive shell", async () => {
      const service = new TerminalService();
      try {
        const run = service.runCommand({
          origin: "core",
          projectId: "p1",
          workspaceId: "w1",
          cwd: process.cwd(),
          title: "Done command",
          command: "true",
        });
        await terminalExit(service, run.terminalId);

        const continued = service.continue(scope(), run.terminalId);

        expect(continued).toMatchObject({ id: run.terminalId, exited: false });
        expect(continued.commandRunId).toBeUndefined();
        expect(service.get(scope(), run.terminalId)?.commandRunId).toBeUndefined();

        const frame = "__PI_WEB_CONTINUE_ENV_42D8B1__";
        const shellReady = firstLiveTerminalOutput(service, run.terminalId);
        const exit = terminalExit(service, run.terminalId);
        await shellReady;
        service.write(scope(), run.terminalId, `printf '${frame}%s${frame}\\n' "$PI_WEB_TERMINAL"\nexit\n`);

        const output = await exit;
        expect(output).toContain("[已继续进入交互式终端]");
        expect(output).toContain(`${frame}1${frame}`);
      } finally {
        service.dispose();
      }
    });
  });

  it("tracks dedicated terminal command runs through completion", async () => {
    const service = new TerminalService();
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Test command",
        command: "printf 'hello'",
        metadata: { "pi.operation": "test" },
      });

      expect(run).toMatchObject({ status: "running", origin: "core", projectId: "p1", workspaceId: "w1", metadata: { "pi.operation": "test" } });
      expect(service.get(scope(), run.terminalId)).toMatchObject({ commandRunId: run.id });
      expect(service.listCommandRuns({ metadata: { "pi.operation": "test" } })).toHaveLength(1);

      const output = await terminalExit(service, run.terminalId);

      expect(output).toContain("$ printf 'hello'");
      expect(output).toContain("hello");
      expect(service.getCommandRun(run.id)).toMatchObject({ status: "succeeded", exitCode: 0, terminalId: run.terminalId });
      expect(service.listCommandRuns({ statuses: ["succeeded"] }).map((candidate) => candidate.id)).toEqual([run.id]);
    } finally {
      service.dispose();
    }
  });

  it("marks failed command runs when the command exits non-zero", async () => {
    const service = new TerminalService();
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Failing command",
        command: "exit 7",
      });

      await terminalExit(service, run.terminalId);

      expect(service.getCommandRun(run.id)).toMatchObject({ status: "failed", exitCode: 7 });
    } finally {
      service.dispose();
    }
  });

  it("records one host-attributed intent when a command fails", async () => {
    const records: ServerPluginNoticeInput[] = [];
    const service = new TerminalService((input) => { records.push(input); });
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Remove workspace",
        command: "exit 7",
        failureNotice: {
          message: "Workspace removal failed. See terminal output.",
          context: { targetWorkspaceId: "target-workspace" },
        },
      });

      await terminalExit(service, run.terminalId);

      expect(run).not.toHaveProperty("failureNotice");
      expect(service.getCommandRun(run.id)).not.toHaveProperty("failureNotice");
      expect(records).toEqual([{
        severity: "error",
        message: "Workspace removal failed. See terminal output.",
        scope: { projectId: "p1" },
        context: {
          commandRunId: run.id,
          targetWorkspaceId: "target-workspace",
        },
      }]);
    } finally {
      service.dispose();
    }
  });

  it("does not record a failure intent for a successful command", async () => {
    const records: ServerPluginNoticeInput[] = [];
    const service = new TerminalService((input) => { records.push(input); });
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Remove workspace",
        command: "true",
        failureNotice: {
          message: "Workspace removal failed. See terminal output.",
          context: { targetWorkspaceId: "target-workspace" },
        },
      });

      await terminalExit(service, run.terminalId);

      expect(service.getCommandRun(run.id)).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(records).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  it("publishes workspace activity updates across the terminal lifecycle", async () => {
    const workspaceActivity = createWorkspaceActivityRecorder();
    const service = new TerminalService();
    service.bindActivitySink(workspaceActivity);
    const cwd = process.cwd();
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd,
        title: "Lifecycle command",
        command: "true",
      });
      expect(requireTerminal(service, run.terminalId).exited).toBe(false);
      expect(workspaceActivity.updated).toEqual([{ id: run.terminalId, cwd, exited: false }]);

      await terminalExit(service, run.terminalId);
      expect(requireTerminal(service, run.terminalId).exited).toBe(true);

      expect(workspaceActivity.updated).toEqual([
        { id: run.terminalId, cwd, exited: false },
        { id: run.terminalId, cwd, exited: true },
      ]);

      service.close(scope(), run.terminalId);

      expect(workspaceActivity.removed).toEqual([{ terminalId: run.terminalId, cwd }]);
    } finally {
      service.dispose();
    }
  });
});

interface WorkspaceActivityRecorder extends TerminalActivitySink {
  readonly updated: TerminalActivityUpdate[];
  readonly removed: TerminalActivityRemoval[];
}

type TerminalActivityUpdate = Pick<TerminalInfo, "id" | "cwd" | "exited">;

interface TerminalActivityRemoval {
  terminalId: string;
  cwd: string | undefined;
}

function createWorkspaceActivityRecorder(): WorkspaceActivityRecorder {
  const updated: TerminalActivityUpdate[] = [];
  const removed: TerminalActivityRemoval[] = [];
  return {
    updated,
    removed,
    updateTerminal: (terminal) => {
      updated.push({ id: terminal.id, cwd: terminal.cwd, exited: terminal.exited });
    },
    removeTerminal: (terminalId, cwd) => {
      removed.push({ terminalId, cwd });
    },
  };
}

function requireTerminal(service: TerminalService, terminalId: string): TerminalInfo {
  const terminal = service.get(scope(), terminalId);
  if (terminal === undefined) throw new Error(`Expected terminal ${terminalId} to exist`);
  return terminal;
}

const LOGIN_PROFILE_COMMAND = "pi-web-test-login-profile-command";
const LOGIN_PROFILE_OUTPUT = "__PI_WEB_LOGIN_PROFILE_PATH_COMMAND__";

async function withBashLoginProfile(run: () => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "pi-web-terminal-home-"));
  const profileBin = join(home, "profile-bin");
  await mkdir(profileBin);
  const commandPath = join(profileBin, LOGIN_PROFILE_COMMAND);
  await writeFile(commandPath, `#!/bin/sh\nprintf '%s\\n' '${LOGIN_PROFILE_OUTPUT}'\n`);
  await chmod(commandPath, 0o755);
  await writeFile(join(home, ".bash_profile"), `export PATH="$HOME/profile-bin:$PATH"\n`);

  const originalHome = process.env["HOME"];
  const originalShell = process.env["SHELL"];
  process.env["HOME"] = home;
  process.env["SHELL"] = "/bin/bash";
  try {
    await run();
  } finally {
    restoreEnv("HOME", originalHome);
    restoreEnv("SHELL", originalShell);
    await rm(home, { recursive: true, force: true });
  }
}

function restoreEnv(key: "HOME" | "SHELL", value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
}

function firstLiveTerminalOutput(service: TerminalService, terminalId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let detach = (): void => undefined;
    const finish = (callback: () => void): void => {
      detach();
      callback();
    };
    try {
      detach = service.attach(scope(), terminalId, {
        output: (_data, replay) => {
          if (!replay) finish(resolve);
        },
        exit: () => { finish(() => { reject(new Error("Continued terminal exited before its shell became ready")); }); },
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function terminalExit(service: TerminalService, terminalId: string): Promise<string> {
  const output: string[] = [];
  return new Promise((resolve, reject) => {
    try {
      service.attach(scope(), terminalId, {
        output: (data) => { output.push(data); },
        exit: () => { resolve(output.join("")); },
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function scope(cwd = process.cwd()): TerminalWorkspaceScope {
  return { projectId: "p1", workspaceId: "w1", cwd };
}
