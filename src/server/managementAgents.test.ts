import * as filesystem from "node:fs/promises";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideManagedAgents, managedAgentsStatus, ManagedAgentsConflictError } from "./managementAgents.js";
import type { ManagedAgentsStatus } from "../shared/managedAgents.js";

vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof filesystem>()) }));

let root: string;
const project = { id: "p1", name: "Project", agentsInstructions: "# Platform instructions\n", agentsInstructionsUpdatedAt: "2026-10-26T12:00:00.000Z", agentsInstructionsPolicy: "replace-managed" as const, agentsInstructionsRevision: "r1" };

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "managed-agents-review-")));
  await writeFile(join(root, "AGENTS.md"), "# Local instructions\n");
  await utimes(join(root, "AGENTS.md"), new Date("2026-01-01"), new Date("2026-01-01"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function available(status: ManagedAgentsStatus) {
  if (!status.available) throw new Error("Expected a template");
  return status;
}

describe("managed AGENTS.md review", () => {
  it.each([
    { time: "2025-12-31T23:59:59.000Z", pending: false },
    { time: "2026-01-01T00:00:00.000Z", pending: false },
    { time: "2026-01-01T00:00:01.000Z", pending: true },
  ])("only prompts when the template is newer than local AGENTS.md: $time", async ({ time, pending }) => {
    expect(available(await managedAgentsStatus(root, { ...project, agentsInstructionsUpdatedAt: time })).pending).toBe(pending);
  });

  it("only reopens an acknowledged review when the template changes, not the local file time", async () => {
    let current = available(await managedAgentsStatus(root, project));
    await decideManagedAgents(root, project, { action: "keep", revision: current.revision });
    await utimes(join(root, "AGENTS.md"), new Date("2026-02-01"), new Date("2026-02-01"));
    current = available(await managedAgentsStatus(root, project));
    expect(current.pending).toBe(false);
    expect(available(await managedAgentsStatus(root, { ...project, agentsInstructionsUpdatedAt: "2026-10-26T12:00:01.000Z" })).pending).toBe(true);
  });

  it("still allows a deliberate overwrite when the local file is newer than the template", async () => {
    const older = { ...project, agentsInstructionsUpdatedAt: "2025-01-01T00:00:00.000Z" };
    const current = available(await managedAgentsStatus(root, older));
    expect(current.pending).toBe(false);
    await decideManagedAgents(root, older, { action: "overwrite", revision: current.revision });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Platform instructions");
  });
  it("keeps reads non-acknowledging, then persists keep without writing or backing up AGENTS.md", async () => {
    const before = await stat(join(root, "AGENTS.md"));
    const first = available(await managedAgentsStatus(root, project));
    expect(first).toMatchObject({ pending: true, templateModifiedAt: project.agentsInstructionsUpdatedAt, modifiedAt: before.mtime.toISOString() });
    expect(available(await managedAgentsStatus(root, project)).pending).toBe(true);
    expect(await decideManagedAgents(root, project, { action: "keep", revision: first.revision })).toMatchObject({ pending: false });
    expect(available(await managedAgentsStatus(root, project)).pending).toBe(false);
    expect((await stat(join(root, "AGENTS.md"))).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# Local instructions\n");
    await expect(stat(join(root, ".pi-web", "agents-backups"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("backs up original bytes using the existing naming scheme before explicit overwrite", async () => {
    const current = available(await managedAgentsStatus(root, project));
    const backups = join(root, ".pi-web", "agents-backups");
    await mkdir(backups, { recursive: true });
    await writeFile(join(backups, "AGENTS.20260101T000000Z.previous.md"), "historical");
    expect(await decideManagedAgents(root, project, { action: "overwrite", revision: current.revision })).toMatchObject({ pending: false });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe('<!-- pi-web-managed-agents:{"source":"management-embed","revision":"r1"} -->\n# Platform instructions\n');
    const names = await readdir(backups);
    expect(names).toHaveLength(2);
    const created = names.find((name) => /^AGENTS\.\d{8}T\d{6}Z\.[a-f0-9]{12}\.md$/.test(name));
    expect(created).toBeDefined();
    expect(await readFile(join(backups, created ?? "missing"), "utf8")).toBe("# Local instructions\n");
    expect(await readFile(join(backups, "AGENTS.20260101T000000Z.previous.md"), "utf8")).toBe("historical");
  });

  it.each([true, false])("creates private files and explicitly restores the target mode (existing=%s)", async (existing) => {
    if (!existing) await rm(join(root, "AGENTS.md"));
    const mode = existing ? (await stat(join(root, "AGENTS.md"))).mode & 0o7777 : 0o600;
    const current = available(await managedAgentsStatus(root, project));
    const writes = vi.spyOn(filesystem, "writeFile");
    const modes = vi.spyOn(filesystem, "chmod");
    await decideManagedAgents(root, project, { action: "overwrite", revision: current.revision });
    expect(writes).toHaveBeenCalledTimes(existing ? 3 : 2);
    for (const call of writes.mock.calls) expect(call[2]).toEqual({ flag: "wx", mode: 0o600 });
    expect(modes).toHaveBeenCalledWith(expect.stringContaining(".AGENTS.md."), mode);
    expect(modes).toHaveBeenCalledWith(expect.stringContaining(".agents-instructions-state.json."), 0o600);
    if (existing) expect(modes).toHaveBeenCalledWith(expect.stringContaining("agents-backups"), 0o600);
  });

  it.skipIf(process.platform === "win32").each([0o600, 0o640, 0o644, 0o750])("preserves POSIX AGENTS.md mode %s while keeping backups private", async (mode) => {
    await chmod(join(root, "AGENTS.md"), mode);
    const current = available(await managedAgentsStatus(root, project));
    await decideManagedAgents(root, project, { action: "overwrite", revision: current.revision });
    expect((await stat(join(root, "AGENTS.md"))).mode & 0o7777).toBe(mode);
    const backups = join(root, ".pi-web", "agents-backups");
    for (const name of await readdir(backups)) expect((await stat(join(backups, name))).mode & 0o7777).toBe(0o600);
    expect((await stat(join(root, ".pi-web", "agents-instructions-state.json"))).mode & 0o7777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("creates missing AGENTS.md with private POSIX permissions", async () => {
    await rm(join(root, "AGENTS.md"));
    const current = available(await managedAgentsStatus(root, project));
    await decideManagedAgents(root, project, { action: "overwrite", revision: current.revision });
    expect((await stat(join(root, "AGENTS.md"))).mode & 0o7777).toBe(0o600);
  });

  it("rejects a stale file snapshot without backups or acknowledgement", async () => {
    const initial = available(await managedAgentsStatus(root, project));
    await writeFile(join(root, "AGENTS.md"), "Concurrent edit\n");
    await expect(decideManagedAgents(root, project, { action: "overwrite", revision: initial.revision })).rejects.toBeInstanceOf(ManagedAgentsConflictError);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("Concurrent edit\n");
    await expect(stat(join(root, ".pi-web"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an outdated template snapshot", async () => {
    const initial = available(await managedAgentsStatus(root, project));
    await expect(decideManagedAgents(root, { ...project, agentsInstructionsRevision: "r2" }, { action: "keep", revision: initial.revision })).rejects.toBeInstanceOf(ManagedAgentsConflictError);
  });

  it("serializes conflicting overwrites and rejects the stale second mutation", async () => {
    const initial = available(await managedAgentsStatus(root, project));
    const results = await Promise.allSettled([
      decideManagedAgents(root, project, { action: "overwrite", revision: initial.revision }),
      decideManagedAgents(root, project, { action: "overwrite", revision: initial.revision }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("offers a missing workspace AGENTS.md without creating it until approved", async () => {
    await rm(join(root, "AGENTS.md"));
    const initial = available(await managedAgentsStatus(root, project));
    expect(initial).toMatchObject({ modifiedAt: null, pending: true });
    await expect(stat(join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await decideManagedAgents(root, project, { action: "overwrite", revision: initial.revision });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Platform instructions");
  });

  it("does not notify without a template time and still permits manual decisions", async () => {
    const legacy = { id: project.id, name: project.name, agentsInstructions: project.agentsInstructions };
    const initial = available(await managedAgentsStatus(root, legacy));
    expect(initial).toMatchObject({ templateModifiedAt: null, pending: false });
    expect(await decideManagedAgents(root, legacy, { action: "keep", revision: initial.revision })).toMatchObject({ pending: false });
    expect(await decideManagedAgents(root, legacy, { action: "overwrite", revision: initial.revision })).toMatchObject({ pending: false });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(project.agentsInstructions);
  });

  it("returns no template when signed instructions are absent", async () => {
    expect(await managedAgentsStatus(root, { id: "p1", name: "Project" })).toEqual({ available: false });
  });

  it.each(["AGENTS.md", ".pi-web", "agents-backups", "agents-instructions-state.json"])("rejects linked managed paths: %s", async (path) => {
    const initial = available(await managedAgentsStatus(root, project));
    const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-agents-outside-")));
    try {
      await writeFile(join(outside, "target.txt"), "OUTSIDE");
      await mkdir(join(root, ".pi-web"), { recursive: true });
      const target = path === "AGENTS.md" || path === ".pi-web" ? join(root, path) : join(root, ".pi-web", path);
      await rm(target, { recursive: true, force: true });
      const directory = path === ".pi-web" || path === "agents-backups";
      await symlink(directory ? outside : join(outside, "target.txt"), target, directory ? "junction" : "file");
      await expect(decideManagedAgents(root, project, { action: "overwrite", revision: initial.revision })).rejects.toThrow("ordinary files and directories");
      expect(await readFile(join(outside, "target.txt"), "utf8")).toBe("OUTSIDE");
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
