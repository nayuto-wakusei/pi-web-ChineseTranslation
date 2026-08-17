import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { RemoteMachineRequestError, type MachineClient } from "./machines/machineClient.js";
import { PI_PACKAGE_MUTATION_PROXY_TIMEOUT_MS, SESSION_TREE_FORK_PROXY_TIMEOUT_MS, SESSION_TREE_NAVIGATION_PROXY_TIMEOUT_MS } from "../shared/federatedRoutes.js";
import { MAX_INLINE_PREVIEW_BYTES } from "../shared/workspaceFiles.js";
import { appTestContext, fakeRemoteClient, registerAppTestHooks } from "./app.testSupport.js";
import { workspaceFilePreviewErrorResponsePolicy, workspaceFilePreviewResponsePolicy } from "./workspaces/filePreviewResponsePolicy.js";

registerAppTestHooks();

describe("buildApp remote machine proxy routes", () => {
  it("proxies allowlisted remote HTTP routes through the selected machine", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn<MachineClient["request"]>(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json", connection: "close" },
      body: Readable.from([JSON.stringify([{ id: "p1", name: "Remote Project", path: "/repo", createdAt: "now" }])]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects?active=true` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual([{ id: "p1", name: "Remote Project", path: "/repo", createdAt: "now" }]);
    expect(request).toHaveBeenCalledWith("GET", "/api/projects?active=true", undefined);
  });

  it("preserves the force-refresh query when proxying update checks", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn<MachineClient["request"]>(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ ok: true })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/pi-web/status?refresh=1` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("GET", "/api/pi-web/status?refresh=1", undefined);
  });

  it("proxies remote Pi package routes and gives package mutations a longer timeout", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn<MachineClient["request"]>((method, path, body) => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ method, path, body })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const listResponse = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/pi-packages` });
    const installBody = { source: "npm:@acme/new-tools" };
    const installResponse = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/pi-packages/install`, payload: installBody });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ method: "GET", path: "/api/pi-packages" });
    expect(installResponse.statusCode).toBe(200);
    expect(installResponse.json()).toEqual({ method: "POST", path: "/api/pi-packages/install", body: installBody });
    expect(request).toHaveBeenNthCalledWith(1, "GET", "/api/pi-packages", undefined);
    expect(request).toHaveBeenNthCalledWith(2, "POST", "/api/pi-packages/install", installBody, { timeoutMs: PI_PACKAGE_MUTATION_PROXY_TIMEOUT_MS });
  });

  it("forwards remote session tree navigation with the model-operation timeout", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn<MachineClient["request"]>((method, path, body) => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ method, path, body })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });
    const navigationBody = { cwd: "/repo", targetId: "entry-1", expectedLeafId: "leaf-1", summary: { mode: "default" } };

    const response = await appTestContext.app.inject({
      method: "POST",
      url: `/api/machines/${remote.id}/sessions/s1/tree/navigate`,
      payload: navigationBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ method: "POST", path: "/api/sessions/s1/tree/navigate", body: navigationBody });
    expect(request).toHaveBeenCalledWith("POST", "/api/sessions/s1/tree/navigate", navigationBody, { timeoutMs: SESSION_TREE_NAVIGATION_PROXY_TIMEOUT_MS });
  });

  it("forwards remote session tree forks with the model-operation timeout", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn<MachineClient["request"]>((method, path, body) => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ method, path, body })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });
    const forkBody = { cwd: "/repo", entryId: "entry-1", expectedLeafId: "leaf-1" };

    const response = await appTestContext.app.inject({
      method: "POST",
      url: `/api/machines/${remote.id}/sessions/s1/tree/fork`,
      payload: forkBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ method: "POST", path: "/api/sessions/s1/tree/fork", body: forkBody });
    expect(request).toHaveBeenCalledWith("POST", "/api/sessions/s1/tree/fork", forkBody, { timeoutMs: SESSION_TREE_FORK_PROXY_TIMEOUT_MS });
  });

  it("proxies remote workspace effective upload config through the existing federated workspace route", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const remoteWorkspaces = [{
      id: "w1",
      projectId: "p1",
      path: "/repo",
      label: "main",
      isMain: true,
      isGitRepo: false,
      isGitWorktree: false,
      effectiveConfig: { uploads: { defaultFolder: "remote-project-uploads" } },
    }];
    const request = vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify(remoteWorkspaces)]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects/p1/workspaces` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(remoteWorkspaces);
    expect(request).toHaveBeenCalledWith("GET", "/api/projects/p1/workspaces", undefined);
  });

  it("overrides weaker remote preview headers with the local security policy", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const body = "<script>window.opener.location = '/stolen'</script>";
    const request = vi.fn<MachineClient["request"]>(() => Promise.resolve({
      statusCode: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "99999",
        "content-disposition": "inline; filename=\"attacker.html\"",
        "content-security-policy": "default-src * 'unsafe-inline' 'unsafe-eval'",
        "set-cookie": "session=secret",
      },
      body: Readable.from([body]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/file/preview?path=${encodeURIComponent("report.html")}` });
    const policy = workspaceFilePreviewResponsePolicy("report.html");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(policy.contentType);
    expect(response.headers["content-disposition"]).toBe(policy.contentDisposition);
    expect(response.headers["content-security-policy"]).toBe(policy.contentSecurityPolicy);
    expect(response.headers["x-content-type-options"]).toBe(policy.contentTypeOptions);
    expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(body)));
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body).toBe(body);
    expect(request.mock.calls[0]?.slice(0, 3)).toEqual(["GET", "/api/projects/p1/workspaces/w1/file/preview?path=report.html", undefined]);
    expect(request.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("hardens remote preview errors", async () => {
    const added = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = added.json<{ id: string }>();
    const body = JSON.stringify({ error: "Missing <script>alert(1)</script>" });
    appTestContext.remoteClient = fakeRemoteClient({ request: vi.fn(() => Promise.resolve({
      statusCode: 404,
      headers: { "content-type": "text/html", "content-security-policy": "default-src *", "x-content-type-options": "sniff" },
      body: Readable.from([body]),
    })) });

    const response = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/file/preview?path=report.html` });
    const policy = workspaceFilePreviewErrorResponsePolicy();
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toBe(policy.contentType);
    expect(response.headers["content-disposition"]).toBe(policy.contentDisposition);
    expect(response.headers["content-security-policy"]).toBe(policy.contentSecurityPolicy);
    expect(response.headers["x-content-type-options"]).toBe(policy.contentTypeOptions);
    expect(response.json()).toEqual({ error: "Missing <script>alert(1)</script>" });
  });

  it("bounds remote inline previews while leaving attachment downloads unbuffered by the limit", async () => {
    const added = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = added.json<{ id: string }>();
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const chunks = Math.ceil(MAX_INLINE_PREVIEW_BYTES / chunk.byteLength) + 1;
    appTestContext.remoteClient = fakeRemoteClient({ request: vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "image/png", "content-length": "4" },
      body: Readable.from(Array.from({ length: chunks }, () => chunk)),
    })) });

    const inline = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/file/preview?path=huge.png` });
    const download = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/file/preview?path=huge.png&download=1` });
    expect(inline.statusCode).toBe(502);
    expect(inline.json<{ detail: string }>().detail).toBe(`Remote machine response exceeded the ${String(MAX_INLINE_PREVIEW_BYTES)} byte limit`);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.byteLength).toBe(chunks * chunk.byteLength);
    expect(download.headers["content-type"]).toBe("application/octet-stream");
  });

  it("proxies remote workspace file writes as raw request bodies", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const request = vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ path: "image.png", size: payload.length, modifiedAt: "now", created: true })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({
      method: "PUT",
      url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/file?path=${encodeURIComponent("image.png")}`,
      payload,
      headers: { "content-type": "application/octet-stream" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ path: "image.png", size: payload.length, modifiedAt: "now", created: true });
    expect(request).toHaveBeenCalledWith("PUT", "/api/projects/p1/workspaces/w1/file?path=image.png", payload, { contentType: "application/octet-stream" });
  });

  it("proxies remote terminal command-run and continue routes", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn((method: string, path: string) => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ method, path })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const createBody = { origin: "core", title: "Build", command: "npm test", metadata: { "pi.operation": "test" } };
    const deleteWorkspaceResponse = await appTestContext.app.inject({ method: "DELETE", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1` });
    const createResponse = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/terminal-command-runs`, payload: createBody });
    const listResponse = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/terminal-command-runs?projectId=p1&statuses=running` });
    const getResponse = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/terminal-command-runs/run1` });
    const cancelResponse = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/terminal-command-runs/run1/cancel` });
    const closeWorkspaceTerminalsResponse = await appTestContext.app.inject({ method: "DELETE", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/terminals` });
    const continueResponse = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/projects/p1/workspaces/w1/terminals/t1/continue` });

    expect(deleteWorkspaceResponse.json()).toEqual({ method: "DELETE", path: "/api/projects/p1/workspaces/w1" });
    expect(createResponse.json()).toEqual({ method: "POST", path: "/api/projects/p1/workspaces/w1/terminal-command-runs" });
    expect(listResponse.json()).toEqual({ method: "GET", path: "/api/terminal-command-runs?projectId=p1&statuses=running" });
    expect(getResponse.json()).toEqual({ method: "GET", path: "/api/terminal-command-runs/run1" });
    expect(cancelResponse.json()).toEqual({ method: "POST", path: "/api/terminal-command-runs/run1/cancel" });
    expect(closeWorkspaceTerminalsResponse.json()).toEqual({ method: "DELETE", path: "/api/projects/p1/workspaces/w1/terminals" });
    expect(continueResponse.json()).toEqual({ method: "POST", path: "/api/projects/p1/workspaces/w1/terminals/t1/continue" });
    expect(request).toHaveBeenCalledWith("POST", "/api/projects/p1/workspaces/w1/terminal-command-runs", createBody);
  });

  it("proxies remote session reloads through the selected machine", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ reloaded: true })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/sessions/s1/reload`, payload: { cwd: "/repo" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reloaded: true });
    expect(request).toHaveBeenCalledWith("POST", "/api/sessions/s1/reload", { cwd: "/repo" });
  });

  it("proxies only the four allowlisted remote notification HTTP routes", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn<MachineClient["request"]>((method, path, body) => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify({ method, path, body })]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const catalog = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/sessions/notifications` });
    const inbox = await appTestContext.app.inject({ method: "GET", url: `/api/machines/${remote.id}/sessions/${encodeURIComponent("s 1")}/notifications?cwd=${encodeURIComponent("/repo one")}` });
    const dismissBody = { cwd: "/repo one", daemonInstanceId: "daemon-test", notificationId: "notice-1" };
    const dismiss = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/sessions/${encodeURIComponent("s 1")}/notifications/dismiss`, payload: dismissBody });
    const dismissAllBody = { cwd: "/repo one", daemonInstanceId: "daemon-test", throughOrder: 7, throughOverflowWatermark: 2 };
    const dismissAll = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/sessions/${encodeURIComponent("s 1")}/notifications/dismiss-all`, payload: dismissAllBody });
    const wrongMethod = await appTestContext.app.inject({ method: "DELETE", url: `/api/machines/${remote.id}/sessions/s1/notifications` });

    expect([catalog.statusCode, inbox.statusCode, dismiss.statusCode, dismissAll.statusCode]).toEqual([200, 200, 200, 200]);
    expect(wrongMethod.statusCode).toBe(404);
    expect(request).toHaveBeenNthCalledWith(1, "GET", "/api/sessions/notifications", undefined);
    expect(request).toHaveBeenNthCalledWith(2, "GET", "/api/sessions/s%201/notifications?cwd=%2Frepo%20one", undefined);
    expect(request).toHaveBeenNthCalledWith(3, "POST", "/api/sessions/s%201/notifications/dismiss", dismissBody);
    expect(request).toHaveBeenNthCalledWith(4, "POST", "/api/sessions/s%201/notifications/dismiss-all", dismissAllBody);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("proxies remote session queue clearing through the allowlisted route", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const status = { sessionId: "s1", pendingMessageCount: 0, queuedMessages: [] };
    const request = vi.fn(() => Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([JSON.stringify(status)]),
    }));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/sessions/s1/queue/clear`, payload: { cwd: "/repo" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
    expect(request).toHaveBeenCalledWith("POST", "/api/sessions/s1/queue/clear", { cwd: "/repo" });
  });

  it("forwards remote JSON request bodies and normalizes remote timeouts", async () => {
    const addResponse = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
    const remote = addResponse.json<{ id: string }>();
    const request = vi.fn(() => Promise.reject(new RemoteMachineRequestError("timed out", 504)));
    appTestContext.remoteClient = fakeRemoteClient({ request });

    const response = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/sessions/s1/prompt`, payload: { text: "hello" } });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ error: "Remote machine timeout", machineId: remote.id, statusCode: 504 });
    expect(request).toHaveBeenCalledWith("POST", "/api/sessions/s1/prompt", { text: "hello" });
  });
});
