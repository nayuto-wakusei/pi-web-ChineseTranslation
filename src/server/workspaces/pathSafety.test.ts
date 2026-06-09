import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRelativePath, resolveInsideWorkspace, resolveParentInsideWorkspace } from "./pathSafety.js";

describe("normalizeRelativePath", () => {
  it("normalizes separators and dot segments", () => {
    expect(normalizeRelativePath("./src//client\\main.ts")).toBe("src/client/main.ts");
  });

  it("rejects absolute paths", () => {
    expect(() => normalizeRelativePath("/etc/passwd")).toThrow("Absolute paths are not allowed");
  });

  it("rejects traversal", () => {
    expect(() => normalizeRelativePath("src/../secret")).toThrow("Path traversal is not allowed");
  });

  it("rejects symlinks that resolve outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-path-safety-"));
    const workspace = join(root, "workspace");
    const outside = join(root, "outside.txt");
    await mkdir(workspace);
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, join(workspace, "link.txt"));
    try {
      await expect(resolveInsideWorkspace(workspace, "link.txt")).rejects.toThrow("Path escapes workspace");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects writable targets whose parent is outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-path-safety-parent-"));
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, join(workspace, "out"));
    try {
      await expect(resolveParentInsideWorkspace(workspace, "out/new.txt")).rejects.toThrow("Path escapes workspace");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
