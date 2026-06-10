import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertManagedCwd,
  createManagementEmbedRuntime,
  managedProjectPath,
  managementToolAllowed,
  projectFromManagedEmbedContext,
  projectsFromManagedEmbedContext,
  readManagementEmbedRequest,
  type ManagementEmbedContext,
} from "./managementEmbed.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pi-web-managed-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("management embed sandbox policy", () => {
  it("derives project roots as safe children of the configured project root", async () => {
    const path = await managedProjectPath(root, "user/../1", "project:alpha");

    expect(path).toBe(join(root, "user-1", "project-alpha"));
  });

  it("rejects cwd values outside authorized managed projects", async () => {
    const context = contextFor([{ id: "p1", name: "Project 1" }]);
    const projectPath = await managedProjectPath(root, "root-user", "p1");
    await mkdir(join(projectPath, "src"), { recursive: true });
    const outside = join(root, "other", "project");
    await mkdir(outside, { recursive: true });

    await expect(assertManagedCwd(root, context, join(projectPath, "src"))).resolves.toBe(join(projectPath, "src"));
    await expect(assertManagedCwd(root, context, outside)).rejects.toThrow("outside the managed project sandbox");
  });

  it("synthesizes pi-web projects from the authorized embed context", async () => {
    const project = await projectFromManagedEmbedContext(root, contextFor([{ id: "p1", name: "Project 1" }]), "p1");

    expect(project).toMatchObject({
      id: "p1",
      name: "Project 1",
      path: join(root, "root-user", "p1"),
    });
  });

  it("synthesizes a default project when the embed context has no projects", async () => {
    const projects = await projectsFromManagedEmbedContext(root, contextFor([]));

    expect(projects).toEqual([
      expect.objectContaining({
        id: "default-project",
        name: "account-1的项目",
        path: join(root, "account-1"),
      }),
    ]);
  });

  it("detects management mode and token from bridge headers", () => {
    expect(readManagementEmbedRequest({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": "token-1" })).toEqual({
      mode: "management",
      token: "token-1",
    });
  });

  it("defaults the management project root under the runtime user home directory", () => {
    const runtime = createManagementEmbedRuntime({
      enabled: true,
      auth: {
        introspectionUrl: "https://auth.example.test/introspect",
        serviceSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      },
    }, {}, "/home/alice");

    expect(runtime?.projectRoot).toBe(join("/home/alice", "PiWeb"));
  });

  it("defaults the management project root to /root/PiWeb for the root user", () => {
    const runtime = createManagementEmbedRuntime({
      enabled: true,
      auth: {
        introspectionUrl: "https://auth.example.test/introspect",
        serviceSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      },
    }, {}, "/root");

    expect(runtime?.projectRoot).toBe(join("/root", "PiWeb"));
  });

  it("always denies interactive shell and terminal tools in management mode", () => {
    const context = contextFor([{ id: "p1", name: "Project 1" }]);

    expect(managementToolAllowed(context, "terminal-command-runs")).toBe(false);
    expect(managementToolAllowed(context, "terminal")).toBe(false);
    expect(managementToolAllowed(context, "shell")).toBe(false);
    expect(managementToolAllowed(context, "bash")).toBe(false);
    expect(managementToolAllowed(context, "read")).toBe(false);
  });
});

function contextFor(projects: ManagementEmbedContext["projects"]): ManagementEmbedContext {
  return {
    user: {
      id: "account-1",
      rootUserId: "root-user",
      roles: ["telecom_staff"],
      permissions: ["runtime:read", "runtime:write", "tools:execute"],
    },
    projects,
    tools: { allow: ["terminal-command-runs"], deny: ["terminal"] },
    expiresAt: "2026-06-08T00:00:00.000Z",
  };
}
