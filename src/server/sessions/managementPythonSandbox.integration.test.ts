import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createManagementSandboxToolDefinitions } from "./piSessionService.js";

const configuredBubblewrapExecutable = process.env["PI_WEB_BWRAP_EXECUTABLE"]?.trim();
const bubblewrapExecutable = configuredBubblewrapExecutable !== undefined && configuredBubblewrapExecutable !== "" ? configuredBubblewrapExecutable : "bwrap";
const sandboxAvailable = process.platform !== "win32" && commandAvailable(bubblewrapExecutable) && commandAvailable("python3");
const integrationIt = sandboxAvailable ? it : it.skip;

describe("managed Python bubblewrap sandbox", () => {
  integrationIt("allows workspace files while blocking host filesystem and network bypasses", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-python-sandbox-"));
    const project = join(root, "project");
    const external = join(root, "secret.txt");
    await mkdir(project);
    await writeFile(external, "host-secret", "utf8");
    await symlink(external, join(project, "link.txt"));
    try {
      const output = await runManagedPython(project, `
import io
import os
import socket
import subprocess
from pathlib import Path

external = ${JSON.stringify(external)}
external_dir = ${JSON.stringify(dirname(external))}
Path("inside.txt").write_text("workspace-ok")
print("inside=" + Path("inside.txt").read_text())

checks = {
    "pathlib": lambda: Path(external).read_text(),
    "io": lambda: io.open(external).read(),
    "osopen": lambda: os.read(os.open(external, os.O_RDONLY), 100).decode(),
    "oslist": lambda: ",".join(os.listdir(external_dir)),
    "osstat": lambda: str(os.stat(external).st_size),
    "symlink": lambda: Path("link.txt").read_text(),
    "subprocess": lambda: subprocess.check_output(["cat", external], text=True),
}
for name, check in checks.items():
    try:
        print(name + "=" + check())
    except Exception:
        print(name + "=blocked")

try:
    sock = socket.create_connection(("1.1.1.1", 53), timeout=0.5)
    sock.close()
    print("network=allowed")
except Exception:
    print("network=blocked")
`);

      expect(output).toContain("inside=workspace-ok");
      for (const name of ["pathlib", "io", "osopen", "oslist", "osstat", "symlink", "subprocess", "network"]) {
        expect(output).toContain(`${name}=blocked`);
      }
      expect(output).not.toContain("host-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function runManagedPython(project: string, code: string): Promise<string> {
  const python = createManagementSandboxToolDefinitions(project, managementContext()).find((tool) => tool.name === "python");
  if (python === undefined) throw new Error("Expected managed Python tool");
  const execute = python.execute.bind(python);
  const result: unknown = await Promise.resolve(Reflect.apply(execute, undefined, ["call-1", { code, timeoutMs: 10_000 }, undefined, undefined, undefined]));
  const content = isRecord(result) ? result["content"] : undefined;
  return Array.isArray(content)
    ? content.map((item) => isRecord(item) && typeof item["text"] === "string" ? item["text"] : "").join("\n")
    : "";
}

function managementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
