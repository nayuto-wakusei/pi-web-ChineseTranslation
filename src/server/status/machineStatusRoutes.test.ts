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
});
