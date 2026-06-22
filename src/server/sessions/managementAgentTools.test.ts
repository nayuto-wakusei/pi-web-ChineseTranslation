import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createManagedAgentToolOptions } from "./managementAgentTools.js";

describe("managed agent tools", () => {
  it("allows file tools inside the managed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    await writeFile(join(root, "README.md"), "hello");
    const options = createManagedAgentToolOptions(root, managementContext());

    await expect(options.read?.operations?.readFile(join(root, "README.md"))).resolves.toEqual(Buffer.from("hello"));
    await expect(options.write?.operations?.writeFile(join(root, "notes.txt"), "ok")).resolves.toBeUndefined();
    await expect(options.ls?.operations?.readdir(root)).resolves.toContain("README.md");
  });

  it("blocks file tools from reading or writing outside the managed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-web-managed-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    const options = createManagedAgentToolOptions(root, managementContext());

    await expect(options.read?.operations?.readFile(join(outside, "secret.txt"))).rejects.toThrow("path outside the managed project sandbox");
    await expect(options.write?.operations?.writeFile(join(outside, "secret.txt"), "changed")).rejects.toThrow("path outside the managed project sandbox");
  });

  it("blocks writes through symlinks that leave the managed workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-web-managed-outside-"));
    await mkdir(join(root, "links"));
    await symlink(outside, join(root, "links", "outside"), "dir");
    const options = createManagedAgentToolOptions(root, managementContext());

    await expect(options.write?.operations?.writeFile(join(root, "links", "outside", "secret.txt"), "changed")).rejects.toThrow("path outside the managed project sandbox");
  });
});

function managementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["runtime:read", "runtime:write", "tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}
