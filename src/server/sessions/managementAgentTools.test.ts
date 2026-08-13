import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createManagedAgentToolOptions } from "./managementAgentTools.js";

describe("managed agent tools", () => {
  it("allows file tools inside the managed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    await writeFile(join(root, "README.md"), "hello");
    const options = createManagedAgentToolOptions(root);

    expect(Object.hasOwn(options, "bash")).toBe(false);
    await expect(options.read.operations.readFile(join(root, "README.md"))).resolves.toEqual(Buffer.from("hello"));
    await expect(options.write.operations.writeFile(join(root, "notes.txt"), "ok")).resolves.toBeUndefined();
    await expect(options.ls.operations.readdir(root)).resolves.toContain("README.md");
  });

  it("maps the Python sandbox workspace path to the managed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    await writeFile(join(root, "README.md"), "hello");
    const options = createManagedAgentToolOptions(root);

    await expect(options.ls.operations.readdir("/workspace")).resolves.toContain("README.md");
    await expect(options.read.operations.readFile("/workspace/README.md")).resolves.toEqual(Buffer.from("hello"));
    await expect(options.write.operations.writeFile("/workspace/notes.txt", "ok")).resolves.toBeUndefined();
  });

  it("does not map similar paths or allow traversal through the Python workspace alias", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-web-managed-outside-"));
    const options = createManagedAgentToolOptions(root);

    await expect(options.ls.operations.readdir("/workspace-other")).rejects.toThrow();
    await expect(options.write.operations.writeFile(`/workspace/../${basename(outside)}/secret.txt`, "changed")).rejects.toThrow("path outside the managed project sandbox");
  });

  it("blocks file tools from reading or writing outside the managed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-web-managed-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    const options = createManagedAgentToolOptions(root);

    await expect(options.read.operations.readFile(join(outside, "secret.txt"))).rejects.toThrow("path outside the managed project sandbox");
    await expect(options.write.operations.writeFile(join(outside, "secret.txt"), "changed")).rejects.toThrow("path outside the managed project sandbox");
  });

  it("blocks writes through symlinks that leave the managed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-web-managed-outside-"));
    await mkdir(join(root, "links"));
    await symlink(outside, join(root, "links", "outside"), "dir");
    const options = createManagedAgentToolOptions(root);

    await expect(options.write.operations.writeFile(join(root, "links", "outside", "secret.txt"), "changed")).rejects.toThrow("path outside the managed project sandbox");
  });
});
