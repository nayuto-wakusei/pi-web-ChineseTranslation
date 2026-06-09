import { describe, expect, it } from "vitest";
import { TerminalService } from "./terminalService";

const terminalIt = process.platform === "win32" ? it.skip : it;

describe("TerminalService command runs", () => {
  terminalIt("tracks dedicated terminal command runs through completion", async () => {
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
      expect(service.get(run.terminalId)).toMatchObject({ commandRunId: run.id });
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

  terminalIt("continues an exited command-run terminal as an interactive shell", async () => {
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

      const continued = service.continue(run.terminalId);

      expect(continued).toMatchObject({ id: run.terminalId, exited: false });
      expect(continued.commandRunId).toBeUndefined();
      expect(service.get(run.terminalId)?.commandRunId).toBeUndefined();
      expect(await terminalReplay(service, run.terminalId)).toContain("[continued in interactive shell]");
    } finally {
      service.dispose();
    }
  });

  terminalIt("marks failed command runs when the command exits non-zero", async () => {
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
});

function terminalReplay(service: TerminalService, terminalId: string): Promise<string> {
  let output = "";
  const detach = service.attach(terminalId, {
    output: (data) => { output += data; },
    exit: () => undefined,
  });
  detach();
  return Promise.resolve(output);
}

function terminalExit(service: TerminalService, terminalId: string): Promise<string> {
  const output: string[] = [];
  return new Promise((resolve, reject) => {
    try {
      service.attach(terminalId, {
        output: (data) => { output.push(data); },
        exit: () => { resolve(output.join("")); },
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
