import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { parseWorkbenchSkillManifest, validateWorkbenchSkillBundle } from "./skillSync.js";

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
