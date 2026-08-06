import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { WorkbenchAccessStateStore } from "./accessStateStore.js";
import { registerWorkbenchAccessStateRoutes, WORKBENCH_ACCESS_STATE_ROUTE } from "./accessStateRoutes.js";

describe("sessiond workbench access state route", () => {
  it("keeps bearer state in the daemon store behind an opaque handle", async () => {
    const app = Fastify({ logger: false });
    const store = new WorkbenchAccessStateStore();
    registerWorkbenchAccessStateRoutes(app, store);
    const state = {
      sessionId: "session-1",
      bearerToken: "private-agent-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      authorizationRevision: 12,
      resources: [],
    };

    const response = await app.inject({ method: "PUT", url: `${WORKBENCH_ACCESS_STATE_ROUTE}/opaque-handle`, payload: state });

    expect(response.statusCode).toBe(204);
    expect(store.require("opaque-handle")).toEqual(state);
    await app.close();
  });
});
