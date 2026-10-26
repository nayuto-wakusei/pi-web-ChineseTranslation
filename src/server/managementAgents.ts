import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileMutationQueue } from "../piSdk.js";
import { UserFacingError } from "../shared/i18n.js";
import type { ManagedAgentsDecision, ManagedAgentsStatus } from "../shared/managedAgents.js";
import { managedAgentsFileContent, type ManagementEmbedContext } from "./managementEmbed.js";

type ManagedProject = ManagementEmbedContext["projects"][number];
const MAX_AGENTS_BYTES = 1024 * 1024;
const STATE_FILE = "agents-instructions-state.json";

export class ManagedAgentsConflictError extends UserFacingError {
  constructor() { super("managementAgents.conflict", "AGENTS.md changed. Review the latest version before deciding."); }
}

export async function managedAgentsStatus(projectPath: string, project: ManagedProject): Promise<ManagedAgentsStatus> {
  if (project.agentsInstructions === undefined || project.agentsInstructions.trim() === "") return { available: false };
  const root = await realpath(projectPath);
  return statusFromSnapshot(root, await snapshot(root, project));
}

export async function decideManagedAgents(projectPath: string, project: ManagedProject, decision: ManagedAgentsDecision): Promise<ManagedAgentsStatus> {
  if (project.agentsInstructions === undefined || project.agentsInstructions.trim() === "") throw new UserFacingError("managementAgents.unavailable", "No managed AGENTS.md template is available.");
  const root = await realpath(projectPath);
  return withFileMutationQueue(join(root, "AGENTS.md"), async () => {
    const before = await snapshot(root, project);
    if (before.revision !== decision.revision) throw new ManagedAgentsConflictError();
    await statusFromSnapshot(root, before);
    const stateDirectory = await safeDirectory(root, ".pi-web", true);
    if (decision.action === "overwrite") {
      if (before.content !== undefined) await backupAgents(root, before.content);
      await atomicWrite(root, "AGENTS.md", before.desired, before.mode ?? 0o600, async () => {
        if ((await snapshot(root, project)).revision !== before.revision) throw new ManagedAgentsConflictError();
      });
    }
    const after = await snapshot(root, project);
    if (decision.action === "keep" && after.revision !== before.revision) throw new ManagedAgentsConflictError();
    await atomicWrite(stateDirectory, STATE_FILE, `${JSON.stringify({ version: 1, templateFingerprint: after.templateFingerprint })}\n`);
    return statusFromSnapshot(root, after);
  });
}

async function snapshot(root: string, project: ManagedProject) {
  const instructions = project.agentsInstructions ?? "";
  const desired = project.agentsInstructionsPolicy === "replace-managed"
    ? managedAgentsFileContent(instructions, project.agentsInstructionsRevision) : instructions;
  const templateRevision = project.agentsInstructionsRevision ?? hash(desired).slice(0, 16);
  const templateModifiedAt = project.agentsInstructionsUpdatedAt ?? null;
  const templateFingerprint = hash(JSON.stringify([hash(desired), templateRevision, templateModifiedAt]));
  const file = await readRegularFile(root, "AGENTS.md");
  const revision = hash(JSON.stringify([templateFingerprint, file?.stamp ?? null]));
  return { desired, templateRevision, templateModifiedAt, templateFingerprint, revision, content: file?.content, mode: file?.mode, modifiedAt: file?.modifiedAt ?? null };
}

async function statusFromSnapshot(root: string, current: Awaited<ReturnType<typeof snapshot>>): Promise<ManagedAgentsStatus> {
  const stateDirectory = await safeDirectory(root, ".pi-web", false);
  const state = stateDirectory === undefined ? undefined : await readRegularFile(stateDirectory, STATE_FILE);
  let acknowledged: string | undefined;
  if (state !== undefined) {
    const value: unknown = JSON.parse(state.content.toString("utf8"));
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1
      || !("templateFingerprint" in value) || typeof value.templateFingerprint !== "string") {
      throw new UserFacingError("managementAgents.invalidState", "Managed AGENTS.md review state is invalid.");
    }
    acknowledged = value.templateFingerprint;
  }
  const newerTemplate = current.templateModifiedAt !== null && (current.modifiedAt === null
    || Date.parse(current.templateModifiedAt) > Date.parse(current.modifiedAt));
  return {
    available: true,
    pending: newerTemplate && current.content?.toString("utf8") !== current.desired && acknowledged !== current.templateFingerprint,
    revision: current.revision,
    modifiedAt: current.modifiedAt,
    templateRevision: current.templateRevision,
    templateModifiedAt: current.templateModifiedAt,
  };
}

async function readRegularFile(root: string, name: string) {
  const target = join(root, name);
  let stat;
  try { stat = await lstat(target); } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw unsafePath();
  if (stat.size > MAX_AGENTS_BYTES) throw new UserFacingError("managementAgents.tooLarge", "Managed AGENTS.md files must not exceed 1 MiB.");
  const handle = await open(target, "r");
  try {
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || await realpath(target) !== target) throw unsafePath();
    const buffer = Buffer.alloc(MAX_AGENTS_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_AGENTS_BYTES) throw new UserFacingError("managementAgents.tooLarge", "Managed AGENTS.md files must not exceed 1 MiB.");
    const content = buffer.subarray(0, bytesRead);
    const after = await handle.stat();
    if (after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || after.size !== opened.size) throw new ManagedAgentsConflictError();
    return { content, mode: after.mode & 0o7777, modifiedAt: after.mtime.toISOString(), stamp: [after.mtimeMs, after.ctimeMs, after.size, after.ino, after.mode, hash(content)] };
  } finally { await handle.close(); }
}

async function safeDirectory(root: string, name: string, create: true): Promise<string>;
async function safeDirectory(root: string, name: string, create: false): Promise<string | undefined>;
async function safeDirectory(root: string, name: string, create: boolean): Promise<string | undefined> {
  const target = join(root, name);
  if (create) {
    try { await mkdir(target); } catch (error) { if (!isCode(error, "EEXIST")) throw error; }
  }
  let stat;
  try { stat = await lstat(target); } catch (error) { if (isMissing(error) && !create) return undefined; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(target) !== target) throw unsafePath();
  return target;
}

async function atomicWrite(root: string, name: string, content: string | Buffer, mode = 0o600, beforeCommit?: () => Promise<void>): Promise<void> {
  if (await realpath(root) !== root) throw unsafePath();
  await readRegularFile(root, name);
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`);
  try {
    // Create privately, then restore the exact mode independently of the process umask.
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await chmod(temporary, mode);
    await beforeCommit?.();
    if (await realpath(root) !== root) throw unsafePath();
    await readRegularFile(root, name);
    await rename(temporary, join(root, name));
  } finally { await rm(temporary, { force: true }); }
}

async function backupAgents(root: string, content: Buffer): Promise<void> {
  const stateDirectory = await safeDirectory(root, ".pi-web", true);
  const backupDirectory = await safeDirectory(stateDirectory, "agents-backups", true);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fingerprint = hash(content).slice(0, 12);
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const suffix = attempt === 0 ? "" : attempt < 10 ? `-${String(attempt)}` : `-${randomUUID().slice(0, 8)}`;
    try {
      if (await realpath(backupDirectory) !== backupDirectory) throw unsafePath();
      const target = join(backupDirectory, `AGENTS.${timestamp}.${fingerprint}${suffix}.md`);
      await writeFile(target, content, { flag: "wx", mode: 0o600 });
      await chmod(target, 0o600);
      return;
    } catch (error) { if (!isCode(error, "EEXIST") || attempt === 10) throw error; }
  }
}

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
function isMissing(error: unknown): boolean { return isCode(error, "ENOENT"); }
function unsafePath(): UserFacingError { return new UserFacingError("managementAgents.unsafePath", "Managed AGENTS.md paths must be ordinary files and directories inside the workspace."); }
