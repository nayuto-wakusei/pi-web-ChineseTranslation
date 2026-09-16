import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createManagedAgentToolOptions, createManagedBashToolDefinition } from "./managementAgentTools.js";

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

  it("registers a constrained bash tool that fails closed without bubblewrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const previous = process.env["PI_WEB_BWRAP_EXECUTABLE"];
    process.env["PI_WEB_BWRAP_EXECUTABLE"] = join(root, "missing-bwrap");
    try {
      const tool = createManagedBashToolDefinition(root, managementContext(), { network: true });
      expect(tool.name).toBe("bash");
      expect(tool.description).toContain("Network access is enabled");
      expect(tool.description).toContain("other host paths are read-only");
      await expect(tool.execute("call-1", { command: "echo hi" }, undefined, undefined, unusedExtensionContext())).rejects.toThrow("Bash sandbox is unavailable");
    } finally {
      if (previous === undefined) delete process.env["PI_WEB_BWRAP_EXECUTABLE"];
      else process.env["PI_WEB_BWRAP_EXECUTABLE"] = previous;
    }
  });
});

function managementContext(): ManagementEmbedContext {
  return {
    user: { id: "account-1", rootUserId: "root-user", roles: [], permissions: ["tools:execute"] },
    projects: [{ id: "project-1", name: "Project 1" }],
  };
}

function unusedExtensionContext(): ExtensionContext {
  const sessionManager = { getSessionId: () => "session-1", getSessionFile: () => undefined };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- execute requires a context the bash tool does not read.
  return { sessionManager } as unknown as ExtensionContext;
}
