import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { createManagedAgentToolOptions, createManagedBashToolDefinition, managedHostPath } from "./managementAgentTools.js";
import * as managementSandbox from "./managementSandbox.js";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

describe("managed agent tools", () => {
  it("preserves real host paths inside a workspace nested below the sandbox alias", () => {
    expect(managedHostPath("/workspace/project", "/workspace/project/file.txt")).toBe("/workspace/project/file.txt");
    expect(managedHostPath("/workspace/project", "/workspace/project")).toBe("/workspace/project");
    expect(managedHostPath("/workspace/project", "/workspace/file.txt")).toBe(resolve("/workspace/project", "file.txt"));
    expect(managedHostPath("/workspace/project", "/workspace/project-other/file.txt")).toBe(resolve("/workspace/project", "project-other/file.txt"));
  });
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
      const tool = createManagedBashToolDefinition(root, managementContext(), { network: true, hostFilesystem: true });
      expect(tool.name).toBe("bash");
      expect(tool.description).toContain("Network access is enabled");
      expect(tool.description).toContain("other host paths are read-only");
      await expect(tool.execute("call-1", { command: "echo hi" }, undefined, undefined, unusedExtensionContext())).rejects.toThrow("Bash sandbox is unavailable");
    } finally {
      if (previous === undefined) delete process.env["PI_WEB_BWRAP_EXECUTABLE"];
      else process.env["PI_WEB_BWRAP_EXECUTABLE"] = previous;
    }
  });

  it("invokes default bash with workspace-only mounts and no network", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-bash-"));
    const invocation = vi.spyOn(managementSandbox, "createBubblewrapShellInvocation");
    vi.stubEnv("PI_WEB_BWRAP_EXECUTABLE", join(root, "missing-bwrap"));
    try {
      const tool = createManagedBashToolDefinition(root, managementContext());
      expect(tool.description).toContain("Paths outside the project are blocked");
      await expect(tool.execute("call-default", { command: "echo hi" }, undefined, undefined, unusedExtensionContext())).rejects.toThrow("Bash sandbox is unavailable");
      expect(invocation).toHaveBeenCalledWith(expect.objectContaining({ hostFilesystem: false, network: false }));
      const result = invocation.mock.results[0];
      if (result?.type !== "return") throw new Error("Expected the real sandbox invocation");
      expect(result.value.args).toEqual(expect.arrayContaining(["--unshare-net", "--bind", "/workspace"]));
      expect(result.value.args).not.toEqual(expect.arrayContaining(["--ro-bind-try", "/", "/"]));
    } finally {
      invocation.mockRestore();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }

  });

  it("passes workspace-only, network-disabled arguments to the default bash process", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const original = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    // Capture production process arguments without requiring Linux namespaces on the test host.
    vi.mocked(spawn).mockImplementationOnce((_command, args) => original.spawn(
      process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...args],
    ));
    const tool = createManagedBashToolDefinition(root, managementContext());
    const result = await tool.execute("call-1", { command: "echo hi" }, undefined, undefined, unusedExtensionContext());
    const output = result.content[0];
    if (output?.type !== "text") throw new Error("Expected sandbox invocation arguments");
    const args: unknown = JSON.parse(output.text);

    expect(args).toEqual(expect.arrayContaining(["--unshare-net", "--clearenv", "--bind", "/workspace", "--chdir", "-lc", "echo hi"]));
    expect(args).not.toContain("/");
    expect(tool.description).toContain("workspace");
    expect(tool.description).not.toContain("other host paths are read-only");
  });

  it("opens host read-only mounts only for explicitly privileged bash", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-tools-"));
    const original = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(spawn).mockImplementationOnce((_command, args) => original.spawn(
      process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...args],
    ));
    const tool = createManagedBashToolDefinition(root, managementContext(), { hostFilesystem: true });
    const result = await tool.execute("call-1", { command: "echo hi" }, undefined, undefined, unusedExtensionContext());
    const output = result.content[0];
    if (output?.type !== "text") throw new Error("Expected sandbox invocation arguments");
    const args: unknown = JSON.parse(output.text);

    expect(args).toEqual(expect.arrayContaining(["--ro-bind-try", "/", "--unshare-net"]));
    expect(tool.description).toContain("other host paths are read-only");
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
