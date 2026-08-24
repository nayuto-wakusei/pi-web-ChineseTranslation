import { mkdtemp, mkdir, realpath, rm, stat } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertManagedCwd,
  createManagementEmbedRuntime,
  managementContextForRequest,
  managementProjectIdForCwd,
  managedProjectPath,
  managementToolAllowed,
  projectFromManagedEmbedContext,
  projectsFromManagedEmbedContext,
  readManagementEmbedRequest,
  type ManagementEmbedContext,
  type ManagementEmbedReplyTarget,
  type ManagementEmbedRequestSource,
} from "./managementEmbed.js";

let root: string;
let nowMs: number;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pi-web-managed-")));
  nowMs = Date.parse("2026-06-10T00:00:00.000Z");
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

  it("creates an authorized project root when asserting it for a managed action", async () => {
    const context = contextFor([{ id: "p1", name: "Project 1" }]);
    const projectPath = join(root, "root-user", "p1");

    await expect(assertManagedCwd(root, context, projectPath)).resolves.toBe(projectPath);
    await expect(pathExists(projectPath)).resolves.toBe(true);
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

  it("lists managed projects without creating their directories", async () => {
    const projects = await projectsFromManagedEmbedContext(root, contextFor([{ id: "p1", name: "Project 1" }]));

    expect(projects).toEqual([expect.objectContaining({ path: join(root, "root-user", "p1") })]);
    await expect(pathExists(join(root, "root-user", "p1"))).resolves.toBe(false);
  });

  it("lists default managed projects without creating their directories", async () => {
    const projects = await projectsFromManagedEmbedContext(root, contextFor([]));

    expect(projects).toEqual([expect.objectContaining({ path: join(root, "account-1") })]);
    await expect(pathExists(join(root, "account-1"))).resolves.toBe(false);
  });

  it("resolves the audit project from the actual managed workspace", async () => {
    const context = contextFor([{ id: "p1", name: "Project 1" }, { id: "p2", name: "Project 2" }]);
    const projectPath = await managedProjectPath(root, "root-user", "p2");
    const cwd = join(projectPath, "src");
    await mkdir(cwd, { recursive: true });

    await expect(managementProjectIdForCwd(root, context, cwd)).resolves.toBe("p2");
  });

  it("detects management mode and token from bridge headers", () => {
    expect(readManagementEmbedRequest({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": "token-1" })).toEqual({
      mode: "management",
      token: "token-1",
    });
  });

  it("does not treat ordinary token query parameters as management embed mode", () => {
    expect(readManagementEmbedRequest({}, { token: "ordinary-page-token" })).toEqual({});
  });

  it("defaults the management project root under the runtime user home directory", () => {
    const runtime = createManagementEmbedRuntime({
      enabled: true,
      auth: {
        sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      },
    }, {}, "/home/alice");

    expect(runtime?.projectRoot).toBe(join("/home/alice", "PiWeb"));
  });

  it("defaults the management project root to /root/PiWeb for the root user", () => {
    const runtime = createManagementEmbedRuntime({
      enabled: true,
      auth: {
        sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      },
    }, {}, "/root");

    expect(runtime?.projectRoot).toBe(join("/root", "PiWeb"));
  });

  it("denies interactive shell and terminal tools while allowing command runs from the signed context", () => {
    const context = contextFor([{ id: "p1", name: "Project 1" }]);

    expect(managementToolAllowed(context, "terminal-command-runs")).toBe(true);
    expect(managementToolAllowed(context, "terminal")).toBe(false);
    expect(managementToolAllowed(context, "shell")).toBe(false);
    expect(managementToolAllowed(context, "bash")).toBe(false);
    expect(managementToolAllowed(context, "read")).toBe(false);
  });

  it("allows command runs when older signed contexts still include them in deny", () => {
    const context = { ...contextFor([{ id: "p1", name: "Project 1" }]), tools: { deny: ["terminal-command-runs"] } };

    expect(managementToolAllowed(context, "terminal-command-runs")).toBe(true);
  });

  it("denies command runs when a non-empty allow list excludes them", () => {
    const context = { ...contextFor([{ id: "p1", name: "Project 1" }]), tools: { allow: ["read"] } };

    expect(managementToolAllowed(context, "terminal-command-runs")).toBe(false);
  });
});

describe("management embed local token authentication", () => {
  it("verifies signed entry tokens and creates an HttpOnly management session", async () => {
    const runtime = runtimeFor("secret-1");
    const reply = replyFor();
    const token = signToken(tokenPayload(contextFor([{ id: "p1", name: "Project 1" }])), "secret-1");

    const context = await managementContextForRequest(requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": token, "x-forwarded-proto": "https" }), runtime, reply);

    expect(context?.user.id).toBe("account-1");
    expect(reply.headers["set-cookie"]?.[0]).toContain("pi_web_management_session=session-1");
    expect(reply.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(reply.headers["set-cookie"]?.[0]).toContain("Secure");
    expect(reply.headers["set-cookie"]?.[0]).toContain("SameSite=None");
    expect(reply.headers["set-cookie"]?.[0]).toContain("Max-Age=86400");
  });

  it("uses the management session after the entry token expires", async () => {
    const runtime = runtimeFor("secret-1");
    const entryReply = replyFor();
    const token = signToken(tokenPayload(contextFor([])), "secret-1");
    await managementContextForRequest(requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": token }), runtime, entryReply);
    const cookie = cookiePair(entryReply);
    nowMs += 10 * 60 * 1000;
    const expiredToken = signToken(tokenPayload(contextFor([{ id: "other", name: "Other" }]), { exp: seconds(nowMs - 1_000) }), "secret-1");

    const context = await managementContextForRequest(requestFor({ cookie }, { embed: "management", token: expiredToken }), runtime, replyFor());

    expect(context?.projects).toEqual([]);
  });

  it("prepares a cached management context before reusing its session cookie", async () => {
    const runtime = runtimeFor("secret-1");
    const prepareContext = vi.fn(() => Promise.resolve());
    runtime.prepareContext = prepareContext;
    const entryReply = replyFor();
    const token = signToken(tokenPayload(contextFor([])), "secret-1");
    await managementContextForRequest(requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": token }), runtime, entryReply);

    await managementContextForRequest(requestFor({ cookie: cookiePair(entryReply) }, { embed: "management" }), runtime, replyFor());

    expect(prepareContext).toHaveBeenCalledTimes(2);
  });

  it("lets a fresh entry token replace a valid session from another user", async () => {
    const runtime = runtimeFor("secret-1");
    const firstReply = replyFor();
    await managementContextForRequest(
      requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": signToken(tokenPayload(contextFor([])), "secret-1") }),
      runtime,
      firstReply,
    );
    const secondContext = { ...contextFor([{ id: "p1", name: "Project 1" }]), user: { ...contextFor([]).user, id: "account-2" } };
    const secondToken = signToken(tokenPayload(secondContext, { jti: "token-2" }), "secret-1");

    const context = await managementContextForRequest(
      requestFor({ cookie: cookiePair(firstReply) }, { embed: "management", token: secondToken }),
      runtime,
      replyFor(),
    );

    expect(context?.user.id).toBe("account-2");
    expect(context?.projects).toEqual([{ id: "p1", name: "Project 1" }]);
  });

  it("ignores management session cookies on ordinary page requests", async () => {
    const runtime = runtimeFor("secret-1");
    const entryReply = replyFor();
    const token = signToken(tokenPayload(contextFor([{ id: "p1", name: "Project 1" }])), "secret-1");
    await managementContextForRequest(requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": token }), runtime, entryReply);

    await expect(
      managementContextForRequest(requestFor({ cookie: cookiePair(entryReply) }, { project: "personal-project", workspace: "w1", session: "s1" }), runtime, replyFor()),
    ).resolves.toBeUndefined();
  });

  it("expires management sessions server-side after 24 hours", async () => {
    const runtime = runtimeFor("secret-1");
    const entryReply = replyFor();
    const token = signToken(tokenPayload(contextFor([])), "secret-1");
    await managementContextForRequest(requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": token }), runtime, entryReply);
    nowMs += 24 * 60 * 60 * 1000 + 1;

    await expect(
      managementContextForRequest(requestFor({ cookie: cookiePair(entryReply) }, { embed: "management" }), runtime, replyFor()),
    ).rejects.toThrow("Management embed session is invalid or expired");
  });

  it("creates a new session from a fresh token when the previous session expired", async () => {
    const runtime = runtimeFor("secret-1");
    const entryReply = replyFor();
    const token = signToken(tokenPayload(contextFor([])), "secret-1");
    await managementContextForRequest(requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": token }), runtime, entryReply);
    nowMs += 24 * 60 * 60 * 1000 + 1;
    const freshToken = signToken(tokenPayload(contextFor([{ id: "p1", name: "Project 1" }])), "secret-1");

    const context = await managementContextForRequest(requestFor({ cookie: cookiePair(entryReply) }, { embed: "management", token: freshToken }), runtime, replyFor());

    expect(context?.projects).toEqual([{ id: "p1", name: "Project 1" }]);
  });

  it.each([
    {
      name: "tampered entry tokens",
      token: () => {
        const signed = signToken(tokenPayload(contextFor([])), "secret-1");
        return signed.replace(/.$/, signed.endsWith("a") ? "b" : "a");
      },
      error: "Management embed token is invalid",
    },
    {
      name: "opaque entry tokens from the old introspection flow",
      token: () => "A05PRNxpc93qJNSkZGTLpBw9xkEtJ4OkhLN1Mw4SITM",
      error: "Management embed token is invalid",
    },
    {
      name: "expired entry tokens",
      token: () => signToken(tokenPayload(contextFor([]), { exp: seconds(nowMs - 1_000) }), "secret-1"),
      error: "Management embed token is expired",
    },
    {
      name: "entry tokens from the wrong issuer",
      token: () => signToken(tokenPayload(contextFor([]), { iss: "other-issuer" }), "secret-1"),
      error: "Management embed token is invalid",
    },
    {
      name: "entry tokens for the wrong audience",
      token: () => signToken(tokenPayload(contextFor([]), { aud: "other-audience" }), "secret-1"),
      error: "Management embed token is invalid",
    },
  ])("rejects $name", async ({ token, error }) => {
    await expect(
      managementContextForRequest(requestFor({ "x-pi-web-embed-mode": "management", "x-pi-web-embed-token": token() }), runtimeFor("secret-1"), replyFor()),
    ).rejects.toThrow(error);
  });
});

function contextFor(projects: ManagementEmbedContext["projects"]): ManagementEmbedContext {
  return {
    user: {
      id: "account-1",
      rootUserId: "root-user",
      displayName: "测试用户",
      roles: ["telecom_staff"],
      permissions: ["runtime:read", "runtime:write", "tools:execute"],
    },
    projects,
    tools: { allow: ["terminal-command-runs"], deny: ["terminal"] },
    expiresAt: "2026-06-08T00:00:00.000Z",
  };
}

function runtimeFor(secret: string) {
  const runtime = createManagementEmbedRuntime({
    enabled: true,
    auth: {
      sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      issuer: "telecom-portal",
      audience: "dify-external-portal",
    },
  }, { PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN: secret }, "/home/alice", {
    now: () => new Date(nowMs),
    randomSessionId: () => "session-1",
  });
  if (runtime === undefined) throw new Error("Expected runtime");
  return runtime;
}

function tokenPayload(context: ManagementEmbedContext, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "telecom-portal",
    aud: "dify-external-portal",
    iat: seconds(nowMs),
    exp: seconds(nowMs + 5 * 60 * 1000),
    jti: "token-1",
    ...context,
    ...overrides,
  };
}

function signToken(payload: Record<string, unknown>, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function requestFor(headers: Record<string, string>, query: Record<string, unknown> = {}): ManagementEmbedRequestSource {
  return { headers, query };
}

function replyFor(): ManagementEmbedReplyTarget & { headers: Record<string, string[]> } {
  const headers: Record<string, string[]> = {};
  return {
    headers,
    header(name: string, value: string) {
      const key = name.toLowerCase();
      this.headers[key] = [...(this.headers[key] ?? []), value];
      return this;
    },
  };
}

function cookiePair(reply: { headers: Record<string, string[] | undefined> }): string {
  const cookie = reply.headers["set-cookie"]?.[0];
  if (cookie === undefined) throw new Error("Expected set-cookie header");
  return cookie.split(";")[0] ?? "";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function seconds(ms: number): number {
  return Math.floor(ms / 1000);
}
