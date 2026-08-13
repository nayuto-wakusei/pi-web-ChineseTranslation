import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import * as yauzl from "yauzl";
import type { PiWebWorkbenchIntegrationConfig } from "../../shared/apiTypes.js";
import type { AuthorizedResource, WorkbenchAgentAccessState, WorkbenchSkillManifest, WorkbenchSkillManifestFile, WorkbenchSkillReceipt, WorkbenchSkillReceiptFile } from "./types.js";
import { isRecord, record, stringField, WorkbenchClient, WorkbenchHttpError } from "./workbenchClient.js";
import type { ManagementAuditIdentity, ManagementAuditRecorder } from "../audit/managementAuditStore.js";

export interface WorkbenchSkillAuditContext extends ManagementAuditIdentity {
  recorder?: ManagementAuditRecorder;
  sessionId: string;
  cwd: string;
}

export class WorkbenchSkillSynchronizer {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: PiWebWorkbenchIntegrationConfig,
    private readonly workbench: WorkbenchClient,
    private readonly dataDir: string,
    fetchImpl: typeof fetch = fetch,
    private readonly logger?: { info(details: Record<string, unknown>, message: string): void },
  ) {
    this.fetchImpl = fetchImpl;
  }

  async synchronize(cwd: string, state: WorkbenchAgentAccessState, audit?: WorkbenchSkillAuditContext): Promise<WorkbenchSkillReceiptFile> {
    const previousReceipt = await this.readReceiptFile(cwd);
    const skills = state.resources.filter((item) => item.resourceType === "skill" && item.status === "published");
    const authorizedCapabilities = new Set(state.resources.filter((item) => item.resourceType === "capability" && item.status === "published" && item.riskLevel === "L0").map((item) => item.resourceName));
    const receipts: WorkbenchSkillReceipt[] = [];
    for (const skill of skills) {
      const requiredMissing = skill.dependencies.filter((item) => item.requirement === "required" && !authorizedCapabilities.has(item.capabilityName));
      if (requiredMissing.length > 0) {
        this.logSkill(state, skill, "required_capability_missing", "Workbench Skill rejected", audit);
        continue;
      }
      try {
        const receipt = await this.synchronizeSkill(cwd, state, skill, authorizedCapabilities);
        receipts.push(receipt);
        this.logSkill(state, skill, "loaded", "Workbench Skill synchronized", audit);
      } catch (error) {
        this.logSkill(state, skill, skillFailureCode(error), "Workbench Skill rejected", audit);
        throw error;
      }
    }
    await this.removeStaleManagedSkills(cwd, previousReceipt, new Set(receipts.map((receipt) => receipt.directory)));
    const receiptFile = { authorizationRevision: state.authorizationRevision, skills: receipts };
    const path = this.receiptPath(cwd);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(receiptFile, null, 2)}\n`, "utf8");
    return receiptFile;
  }

  private async synchronizeSkill(cwd: string, state: WorkbenchAgentAccessState, skill: AuthorizedResource, authorizedCapabilities: Set<string>): Promise<WorkbenchSkillReceipt> {
    if (skill.resourceVersion === "latest" || skill.resourceVersion.trim() === "") throw new Error(`Skill ${skill.resourceName} must use a fixed version`);
    const runId = `skill-sync-${randomUUID()}`;
    const traceId = `trace-${randomUUID()}`;
    const ticket = await this.workbench.issueSkillTicket(state.bearerToken, {
      skillName: skill.resourceName, skillVersion: skill.resourceVersion, runId, traceId, approvalCount: 0,
    });
    const manifest = await this.fetchManifest(ticket, skill.resourceName, skill.resourceVersion);
    validateManifest(manifest, skill, authorizedCapabilities, this.config.skillFileCountMax ?? 200, this.config.skillFileMaxBytes ?? 2 * 1024 * 1024);
    const directory = skillDirectoryName(skill.resourceName, skill.resourceVersion);
    const target = join(cwd, ".pi", "skills", directory);
    const existing = await this.findExistingReceipt(cwd, state.authorizationRevision, skill.resourceName, skill.resourceVersion);
    if (existing?.contentSha256 === manifest.contentSha256 && await verifyReceipt(target, existing)) return existing;

    const bundle = await this.fetchBundle(ticket, skill.resourceName, skill.resourceVersion);
    const files = await validateWorkbenchSkillBundle(bundle, manifest, {
      bundleMaxBytes: this.config.skillBundleMaxBytes ?? 10 * 1024 * 1024,
      fileMaxBytes: this.config.skillFileMaxBytes ?? 2 * 1024 * 1024,
    });
    const staging = `${target}.tmp-${randomUUID()}`;
    await rm(staging, { recursive: true, force: true });
    try {
      for (const file of manifest.files) {
        const output = join(staging, ...file.path.split("/"));
        await mkdir(dirname(output), { recursive: true });
        const content = files.get(file.path);
        if (content === undefined) throw new Error("MCP Skill bundle is missing a manifest file");
        await writeFile(output, content);
      }
      await rm(target, { recursive: true, force: true });
      await mkdir(dirname(target), { recursive: true });
      await rename(staging, target);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return {
      name: skill.resourceName,
      version: skill.resourceVersion,
      directory,
      contentSha256: manifest.contentSha256,
      files: manifest.files.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256 })),
      degradedCapabilities: manifest.dependencies.filter((item) => item.requirement === "optional" && !authorizedCapabilities.has(item.capabilityName)).map((item) => item.capabilityName),
    };
  }

  private async fetchManifest(ticket: string, name: string, version: string): Promise<WorkbenchSkillManifest> {
    const response = await this.skillRequest(ticket, name, version, "manifest");
    return parseWorkbenchSkillManifest(await response.json());
  }

  private async fetchBundle(ticket: string, name: string, version: string): Promise<Buffer> {
    const response = await this.skillRequest(ticket, name, version, "bundle");
    const size = Number(response.headers.get("content-length"));
    const limit = this.config.skillBundleMaxBytes ?? 10 * 1024 * 1024;
    if (Number.isFinite(size) && size > limit) throw new Error("Workbench Skill bundle exceeds the configured size limit");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) throw new Error("Workbench Skill bundle exceeds the configured size limit");
    return buffer;
  }

  private async skillRequest(ticket: string, name: string, version: string, resource: "manifest" | "bundle"): Promise<Response> {
    const mcpUrl = new URL(this.config.mcpUrl);
    const url = new URL(`/integration/v1/skills/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/${resource}`, mcpUrl.origin);
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${ticket}` },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 10_000),
    });
    if (!response.ok) throw new WorkbenchHttpError(
      response.status,
      response.status === 410 ? "该Skill已被管理员停用，请刷新工作台授权后重试。" : `MCP Skill ${resource} returned HTTP ${String(response.status)}`,
    );
    return response;
  }

  private async findExistingReceipt(cwd: string, revision: number, name: string, version: string): Promise<WorkbenchSkillReceipt | undefined> {
    const value = await this.readReceiptFile(cwd);
    if (value?.authorizationRevision !== revision) return undefined;
    return value.skills.find((receipt) => receipt.name === name && receipt.version === version);
  }

  private receiptPath(cwd: string): string {
    const key = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 24);
    return join(this.dataDir, "workbench-integration", key, "skill-receipts.json");
  }

  private logSkill(state: WorkbenchAgentAccessState, skill: AuthorizedResource, result: string | number, message: string, audit?: WorkbenchSkillAuditContext): void {
    const details = {
      ...(audit === undefined ? {} : {
        userId: audit.userId,
        rootUserId: audit.rootUserId,
        ...(audit.userDisplayName === undefined ? {} : { userDisplayName: audit.userDisplayName }),
        projectId: audit.projectId,
        sessionId: audit.sessionId,
        cwd: audit.cwd,
      }),
      agentSessionId: state.sessionId,
      authorizationRevision: state.authorizationRevision,
      skillName: skill.resourceName,
      skillVersion: skill.resourceVersion,
      result,
    };
    this.logger?.info(details, message);
    if (audit?.recorder === undefined) return;
    try {
      audit.recorder.record({
        action: "workbench_skill_sync",
        status: result === "loaded" ? "completed" : "failed",
        userId: audit.userId,
        rootUserId: audit.rootUserId,
        ...(audit.userDisplayName === undefined ? {} : { userDisplayName: audit.userDisplayName }),
        projectId: audit.projectId,
        sessionId: audit.sessionId,
        cwd: audit.cwd,
        agentSessionId: state.sessionId,
        authorizationRevision: state.authorizationRevision,
        skillName: skill.resourceName,
        skillVersion: skill.resourceVersion,
        statusCode: result,
      });
    } catch (error) {
      this.logger?.info({ userId: audit.userId, sessionId: audit.sessionId, skillName: skill.resourceName, error: error instanceof Error ? error.message : String(error) }, "failed to enqueue Workbench Skill audit");
    }
  }

  private async readReceiptFile(cwd: string): Promise<WorkbenchSkillReceiptFile | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.receiptPath(cwd), "utf8"));
      if (!isRecord(value) || typeof value["authorizationRevision"] !== "number" || !Number.isInteger(value["authorizationRevision"]) || !Array.isArray(value["skills"])) return undefined;
      return { authorizationRevision: value["authorizationRevision"], skills: value["skills"].map(parseReceipt) };
    } catch {
      return undefined;
    }
  }

  private async removeStaleManagedSkills(cwd: string, previous: WorkbenchSkillReceiptFile | undefined, keep: Set<string>): Promise<void> {
    if (previous === undefined) return;
    const stale = previous.skills.map((skill) => skill.directory).filter((directory) => directory.startsWith("workbench-") && !keep.has(directory));
    await Promise.all(stale.map((directory) => rm(join(cwd, ".pi", "skills", directory), { recursive: true, force: true })));
  }
}

function skillFailureCode(error: unknown): string | number {
  return error instanceof WorkbenchHttpError ? error.status : "validation_or_mcp_error";
}

export async function verifyReceipt(root: string, receipt: WorkbenchSkillReceipt): Promise<boolean> {
  try {
    for (const file of receipt.files) {
      const path = join(root, ...file.path.split("/"));
      const content = await readFile(path);
      if (content.length !== file.sizeBytes || sha256(content) !== file.sha256) return false;
    }
    return receipt.files.some((file) => file.path === "SKILL.md");
  } catch {
    return false;
  }
}

function validateManifest(manifest: WorkbenchSkillManifest, skill: AuthorizedResource, capabilities: Set<string>, maxFiles: number, maxFileBytes: number): void {
  if (manifest.name !== skill.resourceName || manifest.version !== skill.resourceVersion || manifest.status !== "published") throw new Error("MCP Skill manifest does not match the authorized fixed version");
  if (manifest.files.length < 1 || manifest.files.length > maxFiles || !manifest.files.some((file) => file.path === "SKILL.md")) throw new Error("MCP Skill manifest has an invalid file set");
  if (manifest.files.some((file) => file.sizeBytes > maxFileBytes || file.secretFindings.length > 0)) throw new Error("MCP Skill manifest violates file or secret-scan policy");
  const requiredMissing = manifest.dependencies.filter((item) => item.requirement === "required" && !capabilities.has(item.capabilityName));
  if (requiredMissing.length > 0) throw new Error("MCP Skill required capabilities are not authorized");
}

export function parseWorkbenchSkillManifest(value: unknown): WorkbenchSkillManifest {
  const manifest = record(value, "MCP Skill manifest");
  const files = manifest["files"];
  const dependencies = manifest["dependencies"];
  if (!Array.isArray(files) || !Array.isArray(dependencies)) throw new Error("MCP Skill manifest files and dependencies must be arrays");
  return {
    name: stringField(manifest, "name"),
    version: manifestVersion(manifest["version"]),
    status: stringField(manifest, "status"),
    contentSha256: hexSha256Field(manifest, "content_sha256"),
    dependencies: dependencies.map((value) => {
      const dependency = record(value, "MCP Skill dependency");
      const requirement = stringField(dependency, "requirement");
      if (requirement !== "required" && requirement !== "optional") throw new Error("MCP Skill dependency requirement is invalid");
      return { capabilityName: stringField(dependency, "capability_name"), requirement };
    }),
    files: files.map(parseManifestFile),
  };
}

function parseManifestFile(value: unknown): WorkbenchSkillManifestFile {
  const file = record(value, "MCP Skill file");
  const sizeBytes = file["size_bytes"];
  const findings = file["secret_findings_json"];
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 0 || !Array.isArray(findings)) throw new Error("MCP Skill file metadata is invalid");
  return {
    path: safeArchivePath(stringField(file, "path")),
    mimeType: typeof file["mime_type"] === "string" ? file["mime_type"] : "application/octet-stream",
    sizeBytes,
    sha256: hexSha256Field(file, "sha256"),
    isScript: file["is_script"] === true,
    secretFindings: findings,
  };
}

export async function validateWorkbenchSkillBundle(buffer: Buffer, manifest: WorkbenchSkillManifest, limits: { bundleMaxBytes: number; fileMaxBytes: number }): Promise<Map<string, Buffer>> {
  if (buffer.length > limits.bundleMaxBytes) throw new Error("MCP Skill bundle exceeds the configured size limit");
  const expected = new Map(manifest.files.map((file) => [normalizedArchiveKey(file.path), file]));
  if (expected.size !== manifest.files.length) throw new Error("MCP Skill manifest contains colliding paths");
  const contents = new Map<string, Buffer>();
  await visitZip(buffer, async (entry, open) => {
    assertSafeZipEntry(entry);
    if (entry.fileName.endsWith("/")) return;
    const path = safeArchivePath(entry.fileName);
    const key = normalizedArchiveKey(path);
    const file = expected.get(key);
    if (file === undefined || contents.has(file.path)) throw new Error("MCP Skill bundle contains unexpected or duplicate paths");
    if (entry.uncompressedSize > limits.fileMaxBytes || entry.uncompressedSize !== file.sizeBytes) throw new Error("MCP Skill bundle file size is invalid");
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 100) throw new Error("MCP Skill bundle compression ratio is unsafe");
    const content = await open();
    if (sha256(content) !== file.sha256) throw new Error("MCP Skill bundle file hash does not match the manifest");
    contents.set(file.path, content);
  });
  if (contents.size !== manifest.files.length) throw new Error("MCP Skill bundle is missing manifest files");
  const contentHash = sha256(Buffer.from(manifest.files.map((file) => file.sha256).join(""), "utf8"));
  if (contentHash !== manifest.contentSha256) throw new Error("MCP Skill content hash does not match the manifest");
  return contents;
}

function visitZip(buffer: Buffer, visit: (entry: yauzl.Entry, open: () => Promise<Buffer>) => Promise<void>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (error, zip) => {
      if (error !== null) { reject(error); return; }
      let settled = false;
      const fail = (caught: unknown) => { if (!settled) { settled = true; zip.close(); reject(toError(caught)); } };
      zip.on("error", fail);
      zip.on("end", () => { if (!settled) { settled = true; resolvePromise(); } });
      zip.on("entry", (entry: yauzl.Entry) => {
        void visit(entry, () => readZipEntry(zip, entry)).then(() => { zip.readEntry(); }).catch(fail);
      });
      zip.readEntry();
    });
  });
}

function readZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null) { reject(error); return; }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => { resolvePromise(Buffer.concat(chunks)); });
    });
  });
}

function parseReceipt(value: unknown): WorkbenchSkillReceipt {
  const receipt = record(value, "Workbench Skill receipt");
  const files = receipt["files"];
  const degraded = receipt["degradedCapabilities"];
  if (!Array.isArray(files) || !Array.isArray(degraded) || !degraded.every((item) => typeof item === "string")) throw new Error("Workbench Skill receipt is invalid");
  return {
    name: stringField(receipt, "name"),
    version: stringField(receipt, "version"),
    directory: stringField(receipt, "directory"),
    contentSha256: hexSha256Field(receipt, "contentSha256"),
    files: files.map((entry) => {
      const file = record(entry, "Workbench Skill receipt file");
      const sizeBytes = file["sizeBytes"];
      if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 0) throw new Error("Workbench Skill receipt file is invalid");
      return { path: safeArchivePath(stringField(file, "path")), sizeBytes, sha256: hexSha256Field(file, "sha256") };
    }),
    degradedCapabilities: degraded,
  };
}

function manifestVersion(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  throw new Error("MCP Skill manifest version is invalid");
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function assertSafeZipEntry(entry: yauzl.Entry): void {
  const mode = entry.externalFileAttributes >>> 16;
  const fileType = mode & 0o170000;
  const expectedType = entry.fileName.endsWith("/") ? 0o040000 : 0o100000;
  if (fileType !== 0 && fileType !== expectedType) throw new Error("MCP Skill bundle contains a link or non-regular file");
}

function safeArchivePath(value: string): string {
  const withSlashes = value.replace(/\\/gu, "/");
  const normalizedPath = normalize(withSlashes).replace(/\\/gu, "/");
  if (isAbsolute(value) || withSlashes.startsWith("/") || /^[A-Za-z]:\//u.test(withSlashes) || normalizedPath === ".." || normalizedPath.startsWith("../") || withSlashes.split("/").includes("..")) {
    throw new Error("MCP Skill bundle path is unsafe");
  }
  if (normalizedPath === "" || normalizedPath === ".") throw new Error("MCP Skill bundle path is empty");
  return normalizedPath.normalize("NFC");
}

function normalizedArchiveKey(value: string): string {
  return safeArchivePath(value).normalize("NFC").toLocaleLowerCase();
}

function skillDirectoryName(name: string, version: string): string {
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 12);
  const safeVersion = version.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 40);
  return `workbench-${hash}-v${safeVersion}`;
}

function hexSha256Field(value: Record<string, unknown>, key: string): string {
  const field = stringField(value, key).toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(field)) throw new Error(`${key} must be a SHA-256 digest`);
  return field;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
