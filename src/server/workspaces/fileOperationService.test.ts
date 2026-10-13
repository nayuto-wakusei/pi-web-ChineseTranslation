import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempWorkspaces, createTempWorkspace } from "./fileContentService.testSupport.js";
import { deleteWorkspaceDirectory, moveWorkspaceDirectory } from "./fileOperationService.js";

afterEach(cleanupTempWorkspaces);

describe("workspace directory mutations", () => {
  it("moves a real directory and preserves its contents", async () => {
    const root = await createTempWorkspace();
    await mkdir(join(root, "original"));
    await writeFile(join(root, "original", "keep.txt"), "keep");
    expect(await moveWorkspaceDirectory(root, { fromPath: "original", toPath: "renamed" })).toEqual({ path: "renamed" });
    expect(await readFile(join(root, "renamed", "keep.txt"), "utf8")).toBe("keep");
    await expect(lstat(join(root, "original"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deletes only empty real directories", async () => {
    const root = await createTempWorkspace();
    await mkdir(join(root, "empty"));
    expect(await deleteWorkspaceDirectory(root, "empty")).toEqual({ deleted: true, path: "empty" });
    await expect(lstat(join(root, "empty"))).rejects.toMatchObject({ code: "ENOENT" });
    await mkdir(join(root, "nonempty"));
    await writeFile(join(root, "nonempty", "keep.txt"), "keep");
    await expect(deleteWorkspaceDirectory(root, "nonempty")).rejects.toThrow("Directory is not empty");
    expect(await readFile(join(root, "nonempty", "keep.txt"), "utf8")).toBe("keep");
  });

  it.each(["move", "delete"] as const)("rejects %s of a final directory symlink without touching the target", async (operation) => {
    const root = await createTempWorkspace();
    await mkdir(join(root, "original"));
    await symlink(join(root, "original"), join(root, "alias"), "junction");
    const result = operation === "move"
      ? moveWorkspaceDirectory(root, { fromPath: "alias", toPath: "renamed" })
      : deleteWorkspaceDirectory(root, "alias");
    await expect(result).rejects.toThrow("Path is not a directory");
    expect((await lstat(join(root, "original"))).isDirectory()).toBe(true);
    expect((await lstat(join(root, "alias"))).isSymbolicLink()).toBe(true);
    await expect(lstat(join(root, "renamed"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows real directories beneath an in-workspace symlink parent", async () => {
    const root = await createTempWorkspace();
    await mkdir(join(root, "original", "child"), { recursive: true });
    await symlink(join(root, "original"), join(root, "alias"), "junction");
    await moveWorkspaceDirectory(root, { fromPath: "alias/child", toPath: "alias/renamed" });
    expect((await lstat(join(root, "original", "renamed"))).isDirectory()).toBe(true);
    await deleteWorkspaceDirectory(root, "alias/renamed");
    await expect(lstat(join(root, "original", "renamed"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(join(root, "alias"))).isSymbolicLink()).toBe(true);
  });

  it("rejects source and destination parents pointing outside the workspace", async () => {
    const root = await createTempWorkspace();
    const outside = await createTempWorkspace();
    await mkdir(join(outside, "child"));
    await mkdir(join(root, "local"));
    await symlink(outside, join(root, "alias"), "junction");
    await expect(moveWorkspaceDirectory(root, { fromPath: "alias/child", toPath: "moved" })).rejects.toThrow("Path escapes workspace");
    await expect(moveWorkspaceDirectory(root, { fromPath: "local", toPath: "alias/moved" })).rejects.toThrow("Path escapes workspace");
    await expect(deleteWorkspaceDirectory(root, "alias/child")).rejects.toThrow("Path escapes workspace");
    expect((await lstat(join(outside, "child"))).isDirectory()).toBe(true);
    expect((await lstat(join(root, "local"))).isDirectory()).toBe(true);
  });
});
