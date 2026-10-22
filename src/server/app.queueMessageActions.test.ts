import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import type { MachineClient } from "./machines/machineClient.js";
import { appTestContext, fakeRemoteClient, registerAppTestHooks } from "./app.testSupport.js";

registerAppTestHooks();

it.each(["/api", "/api/machines/local"])("forwards queue mutation unchanged through local alias %s", async (prefix) => {
  const payload = { cwd: appTestContext.projectDir, action: "remove", index: 0, expectedQueue: [{ kind: "steer", text: "queued" }] };
  const response = await appTestContext.app.inject({ method: "POST", url: `${prefix}/sessions/s1/queue/message`, payload });
  expect(response.statusCode).toBe(200);
  expect(appTestContext.sessionDaemonRequests).toEqual([{ method: "POST", path: "/sessions/s1/queue/message", body: payload }]);
});

it("forwards remote stale-queue refusal once without falling back to the gateway daemon", async () => {
  const added = await appTestContext.app.inject({ method: "POST", url: "/api/machines", payload: { name: "Remote", baseUrl: "https://remote.example.test/" } });
  const remote = added.json<{ id: string }>();
  const request = vi.fn<MachineClient["request"]>(() => Promise.resolve({
    statusCode: 409, headers: { "content-type": "application/json" }, body: Readable.from([JSON.stringify({ error: "Queue changed" })]),
  }));
  appTestContext.remoteClient = fakeRemoteClient({ request });
  const payload = { cwd: "/remote/repo", action: "edit", index: 0, expectedQueue: [{ kind: "followUp", text: "queued" }] };
  const response = await appTestContext.app.inject({ method: "POST", url: `/api/machines/${remote.id}/sessions/s1/queue/message`, payload });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: "Queue changed" });
  expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/sessions/s1/queue/message", payload);
  expect(appTestContext.sessionDaemonRequests).toEqual([]);
});
