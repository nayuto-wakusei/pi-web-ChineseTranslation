import { describe, expect, it, vi } from "vitest";
import { CORE_STATUS_FLAGS, type MachineStatusSnapshot } from "../../shared/machineStatus.js";
import { MachineStatusService, type ActiveCwdActivity } from "./machineStatusService.js";

function activity(workspaces: readonly ActiveCwdActivity[]) {
  return { activeSnapshot: () => ({ workspaces }) };
}

function unread(cwds: readonly string[]) {
  return {
    catalogSnapshot: () => ({
      catalogId: "catalog",
      catalogRevision: 1,
      sessions: cwds.map((cwd, index) => ({ sessionId: `s${String(index)}`, cwd, completionOrder: index + 1, completedAt: "now" })),
    }),
  };
}

describe("MachineStatusService", () => {
  it("attributes active and unread cwd flags and rolls them up", async () => {
    const published: MachineStatusSnapshot[] = [];
    const service = new MachineStatusService({
      activity: activity([
        { cwd: "/repo/main", hasSessionActivity: true, hasTerminalActivity: false },
        { cwd: "/outside", hasSessionActivity: false, hasTerminalActivity: true },
      ]),
      unread: unread(["/repo/main", "/repo/other"]),
      attribution: { attribute: () => Promise.resolve(new Map([
        ["/repo/main", { projectId: "project-1", workspaceId: "workspace-1" }],
        ["/repo/other", { projectId: "project-1", workspaceId: "workspace-2" }],
      ])) },
      publisher: { publish: (snapshot) => published.push(snapshot) },
      logger: { warn: vi.fn() },
    });

    await service.refresh();

    expect(service.snapshot()).toMatchObject({
      revision: 1,
      machine: { [CORE_STATUS_FLAGS.working]: true, [CORE_STATUS_FLAGS.terminal]: true, [CORE_STATUS_FLAGS.unread]: true },
      projects: { "project-1": { [CORE_STATUS_FLAGS.working]: true, [CORE_STATUS_FLAGS.unread]: true } },
      workspaces: {
        "workspace-1": { [CORE_STATUS_FLAGS.working]: true, [CORE_STATUS_FLAGS.unread]: true },
        "workspace-2": { [CORE_STATUS_FLAGS.unread]: true },
      },
      unattributed: { [CORE_STATUS_FLAGS.terminal]: true },
    });
    expect(published).toHaveLength(1);
    await service.refresh();
    expect(published).toHaveLength(1);
  });

  it("keeps snapshots and publications isolated by event scope", async () => {
    const published: { snapshot: MachineStatusSnapshot; scope: string }[] = [];
    const service = new MachineStatusService({
      activity: {
        activeSnapshot: (scope = "normal") => ({
          workspaces: scope === "normal"
            ? [{ cwd: "/normal", hasSessionActivity: true, hasTerminalActivity: false }]
            : [{ cwd: "/managed", hasSessionActivity: false, hasTerminalActivity: true }],
        }),
      },
      unread: { catalogSnapshot: () => ({ sessions: [], catalogId: "catalog", catalogRevision: 1 }) },
      attribution: { attribute: (cwds) => Promise.resolve(new Map([...cwds].map((cwd) => [cwd, { projectId: "p", workspaceId: cwd.slice(1) }]))) },
      publisher: { publish: (snapshot, scope) => published.push({ snapshot, scope }) },
      logger: { warn: vi.fn() },
    });

    await service.refresh("normal");
    await service.refresh("management:one");

    expect(service.snapshot("normal").machine).toEqual({ [CORE_STATUS_FLAGS.working]: true });
    expect(service.snapshot("management:one").machine).toEqual({ [CORE_STATUS_FLAGS.terminal]: true });
    expect(published.map(({ scope }) => scope)).toEqual(["normal", "management:one"]);
  });
});
