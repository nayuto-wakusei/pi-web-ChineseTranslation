import * as filesystem from "node:fs/promises";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalSessionReadAllowed } from "./sessionReadAccess.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "pi-web-read-path-")); });
afterEach(async () => { vi.clearAllMocks(); await rm(directory, { recursive: true, force: true }); });
const authorized = (cwd: string) => Promise.resolve(cwd);

describe("normal session read paths", () => {
  it("retains authorized ordinary reads when no management root is configured", async () => {
    const cwd = join(directory, "not-created");
    const realpath = vi.mocked(filesystem.realpath);
    expect(await normalSessionReadAllowed(cwd, authorized, undefined)).toBe(true);
    expect(realpath).not.toHaveBeenCalled();
  });

  it.each(["", "user/project"])("rejects the reserved root and lexical descendants before following symlinks: %s", async (suffix) => {
    const root = join(directory, "managed");
    expect(await normalSessionReadAllowed(join(root, suffix), authorized, root)).toBe(false);
  });

  it("does not mistake a same-prefix sibling for the reserved root", async () => {
    const root = join(directory, "managed");
    const cwd = join(directory, "managed-ordinary", "deleted-worktree");
    expect(await normalSessionReadAllowed(cwd, authorized, root)).toBe(true);
  });

  it("rejects a workspace alias into the management root, including a missing descendant", async () => {
    const root = join(directory, "managed");
    const alias = join(directory, "ordinary-alias");
    await mkdir(root);
    await symlink(root, alias, "junction");
    expect(await normalSessionReadAllowed(alias, authorized, root)).toBe(false);
    expect(await normalSessionReadAllowed(join(alias, "deleted-worktree"), authorized, root)).toBe(false);
  });

  it("resolves the reserved root's own alias before comparing physical paths", async () => {
    const physical = join(directory, "physical-managed");
    const root = join(directory, "configured-root");
    await mkdir(physical);
    await symlink(physical, root, "junction");
    expect(await normalSessionReadAllowed(join(physical, "project"), authorized, root)).toBe(false);
  });

  it("does not let a lexical managed descendant escape exclusion through an outward alias", async () => {
    const root = join(directory, "managed");
    const ordinary = join(directory, "ordinary");
    await Promise.all([mkdir(root), mkdir(ordinary)]);
    const alias = join(root, "outward");
    await symlink(ordinary, alias, "junction");
    expect(await normalSessionReadAllowed(alias, authorized, root)).toBe(false);
  });

  it.each(["EACCES", "ENOTDIR", "ELOOP"])("fails closed on %s canonicalization failures", async (code) => {
    const root = join(directory, "managed");
    const cwd = join(directory, "ordinary");
    const realpath = vi.mocked(filesystem.realpath).mockRejectedValueOnce(Object.assign(new Error("Unverifiable path"), { code }));
    expect(await normalSessionReadAllowed(cwd, authorized, root)).toBe(false);
    expect(realpath).toHaveBeenCalledWith(root);
  });
});
