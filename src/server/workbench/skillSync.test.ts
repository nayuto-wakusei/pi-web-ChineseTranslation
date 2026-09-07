import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZipFile } from "yazl";
import { parseWorkbenchSkillManifest, validateWorkbenchSkillBundle, WorkbenchSkillSynchronizer } from "./skillSync.js";
import type { WorkbenchAgentAccessState } from "./types.js";
import { WorkbenchClient } from "./workbenchClient.js";

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Workbench Skill synchronization", () => {
  it("serializes complete workspace updates across synchronizer instances", async () => {
    const { cwd, dataDir, config, workbench, fetchBundle, content } = await syncFixture();
    const synchronizers = Array.from({ length: 8 }, () => new WorkbenchSkillSynchronizer(config, workbench, dataDir, fetchBundle));

    const results = await Promise.all(synchronizers.map((sync) => sync.synchronize(cwd, accessState())));

    expect(results).toHaveLength(8);
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
    const receipt = results[0]?.skills[0];
    expect(receipt).toBeDefined();
    await expect(readFile(join(cwd, ".pi", "skills", receipt?.directory ?? "", "SKILL.md"))).resolves.toEqual(content);
    expect(fetchBundle.mock.calls.filter(([url]) => requestUrl(url).endsWith("/bundle"))).toHaveLength(1);
    await expect(readdir(join(cwd, ".pi", "skills"))).resolves.toEqual([receipt?.directory]);
  });

  it("allows different workspaces to proceed while one workspace is waiting", async () => {
    const { cwd, dataDir, config, workbench, fetchBundle } = await syncFixture();
    const otherCwd = join(cwd, "other");
    await mkdir(otherCwd);
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let first = true;
    const sync = new WorkbenchSkillSynchronizer(config, workbench, dataDir, async (...args) => {
      if (first) {
        first = false;
        entered?.();
        await blocked;
      }
      return fetchBundle(...args);
    });
    const pending = sync.synchronize(cwd, accessState());
    await started;
    try {
      const other = await sync.synchronize(otherCwd, accessState());
      expect(other.skills).toHaveLength(1);
    } finally {
      release?.();
      await pending;
    }
  });

  it("releases the workspace queue after failure and removes stale managed directories", async () => {
    const { cwd, dataDir, config, workbench, fetchBundle } = await syncFixture();
    fetchBundle.mockRejectedValueOnce(new Error("manifest unavailable"));
    const sync = new WorkbenchSkillSynchronizer(config, workbench, dataDir, fetchBundle);
    await expect(sync.synchronize(cwd, accessState())).rejects.toThrow("manifest unavailable");
    const recovered = await sync.synchronize(cwd, accessState());
    expect(recovered.skills).toHaveLength(1);

    await expect(sync.synchronize(cwd, { ...accessState(), authorizationRevision: 2, resources: [] }))
      .resolves.toEqual({ authorizationRevision: 2, skills: [] });
    await expect(readdir(join(cwd, ".pi", "skills"))).resolves.toEqual([]);
  });
});

describe("Workbench Skill validation", () => {
  it("accepts a fixed manifest-matching bundle", async () => {
    const content = Buffer.from("---\nname: demo\ndescription: Demo\n---\n", "utf8");
    const fileHash = sha256(content);
    const manifest = parseWorkbenchSkillManifest(manifestValue([{ path: "SKILL.md", content, sha256: fileHash }], sha256(Buffer.from(fileHash))));
    const bundle = await zip([{ path: "SKILL.md", content }]);

    await expect(validateWorkbenchSkillBundle(bundle, manifest, { bundleMaxBytes: 1_000_000, fileMaxBytes: 10_000 }))
      .resolves.toEqual(new Map([["SKILL.md", content]]));
  });

  it("rejects path traversal and Unicode/case-colliding manifest paths", async () => {
    expect(() => parseWorkbenchSkillManifest(manifestValue([{ path: "../SKILL.md", content: Buffer.alloc(0), sha256: sha256(Buffer.alloc(0)) }], sha256(Buffer.alloc(0)))))
      .toThrow("path is unsafe");

    const first = Buffer.from("a");
    const second = Buffer.from("b");
    const firstHash = sha256(first);
    const secondHash = sha256(second);
    const manifest = parseWorkbenchSkillManifest(manifestValue([
      { path: "SKILL.md", content: first, sha256: firstHash },
      { path: "skill.md", content: second, sha256: secondHash },
    ], sha256(Buffer.from(`${firstHash}${secondHash}`))));
    await expect(validateWorkbenchSkillBundle(Buffer.alloc(0), manifest, { bundleMaxBytes: 1_000_000, fileMaxBytes: 10_000 }))
      .rejects.toThrow("colliding paths");
  });

  it("rejects symbolic-link entries", async () => {
    const content = Buffer.from("target", "utf8");
    const fileHash = sha256(content);
    const manifest = parseWorkbenchSkillManifest(manifestValue([{ path: "SKILL.md", content, sha256: fileHash }], sha256(Buffer.from(fileHash))));
    const bundle = await zip([{ path: "SKILL.md", content, mode: 0o120777 }]);

    await expect(validateWorkbenchSkillBundle(bundle, manifest, { bundleMaxBytes: 1_000_000, fileMaxBytes: 10_000 }))
      .rejects.toThrow("link or non-regular file");
  });
});

function manifestValue(files: { path: string; content: Buffer; sha256: string }[], contentSha256: string): unknown {
  return {
    name: "installer.demo",
    version: 1,
    status: "published",
    content_sha256: contentSha256,
    dependencies: [],
    files: files.map((file) => ({
      path: file.path,
      mime_type: "text/markdown",
      size_bytes: file.content.length,
      sha256: file.sha256,
      is_script: false,
      secret_findings_json: [],
    })),
  };
}

function zip(files: { path: string; content: Buffer; mode?: number }[]): Promise<Buffer> {
  const archive = new ZipFile();
  for (const file of files) archive.addBuffer(file.content, file.path, file.mode === undefined ? undefined : { mode: file.mode });
  archive.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("error", (error) => { reject(error instanceof Error ? error : new Error(String(error))); });
    archive.outputStream.on("end", () => { resolve(Buffer.concat(chunks)); });
  });
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function syncFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-web-skill-sync-"));
  tempRoots.push(root);
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const config = { baseUrl: "https://workbench.example", mcpUrl: "https://mcp.example" };
  const content = Buffer.from("---\nname: demo\ndescription: Demo\n---\n", "utf8");
  const hash = sha256(content);
  const manifest = manifestValue([{ path: "SKILL.md", content, sha256: hash }], sha256(Buffer.from(hash)));
  const bundle = await zip([{ path: "SKILL.md", content }]);
  const fetchBundle = vi.fn<typeof fetch>((url) => Promise.resolve(requestUrl(url).endsWith("/manifest")
    ? Response.json(manifest)
    : new Response(new Uint8Array(bundle))));
  const workbench = new WorkbenchClient({ baseUrl: config.baseUrl, requestTimeoutMs: 1000, fetch: () => Promise.resolve(Response.json({ token: "test-ticket" })) });
  return { cwd, dataDir: join(root, "data"), config, workbench, fetchBundle, content };
}

function accessState(): WorkbenchAgentAccessState {
  return {
    sessionId: "agent-session", bearerToken: "test-access", expiresAt: "2099-01-01T00:00:00.000Z", authorizationRevision: 1,
    resources: [{
      resourceType: "skill", resourceName: "installer.demo", resourceVersion: "1", source: "group",
      riskLevel: "L0", status: "published", displayName: "Demo", description: "Demo", dependencies: [], metadata: {},
    }],
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}
