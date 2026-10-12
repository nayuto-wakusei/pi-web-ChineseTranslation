import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import type { MachineStatusSnapshot } from "../../shared/machineStatus.js";
import { registerMachineStatusRoutes } from "./machineStatusRoutes.js";

const normalSnapshot: MachineStatusSnapshot = { epochId: "normal", revision: 1, machine: {}, projects: {}, workspaces: {}, unattributed: {}, generatedAt: "now" };
const managementSnapshot: MachineStatusSnapshot = { epochId: "management", revision: 2, machine: { "core:terminal": true }, projects: {}, workspaces: {}, unattributed: {}, generatedAt: "now" };
let app: FastifyInstance;

beforeEach(() => { app = Fastify({ logger: false }); });
afterEach(async () => { await app.close(); });

const snapshot: MachineStatusSnapshot = {
  epochId: "epoch-1",
  revision: 4,
  machine: { "core:working": true },
  projects: { "project-1": { "core:working": true } },
  workspaces: { "workspace-1": { "core:working": true } },
  unattributed: {},
  generatedAt: "2026-07-27T00:00:00.000Z",
};

describe("machine status routes", () => {
  it("selects the snapshot from the forwarded management context", async () => {
    registerMachineStatusRoutes(app, { snapshot: (scope = "normal") => scope === "normal" ? normalSnapshot : managementSnapshot });
    const context: ManagementEmbedContext = {
      user: { id: "user", rootUserId: "root", roles: [], permissions: [] },
      projects: [],
    };

    const response = await app.inject({ method: "GET", url: "/status", headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) } });

    expect(response.statusCode).toBe(200);
    expect(response.json<MachineStatusSnapshot>()).toEqual(managementSnapshot);
  });

  it("serves the current snapshot unchanged, so an explicit refresh and the socket agree", async () => {
    registerMachineStatusRoutes(app, { snapshot: () => snapshot });

    const response = await app.inject({ method: "GET", url: "/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json<MachineStatusSnapshot>()).toEqual(snapshot);
  });
});
