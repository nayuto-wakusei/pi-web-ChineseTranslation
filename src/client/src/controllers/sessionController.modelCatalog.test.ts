import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { createSessionControllerTestFixture, defaultApi, oldSession, sessionLookupId, workspace, type AppState } from "./sessionController.testSupport";

const catalogModels = [
  { provider: "openai", id: "gpt-5", enabled: true },
  { provider: "anthropic", id: "claude-sonnet-4-5", enabled: true },
  { provider: "openai", id: "gpt-4o", enabled: false },
];

function machine(id: string): NonNullable<AppState["selectedMachine"]> {
  return { id, name: id, kind: "remote", createdAt: "now", updatedAt: "now" };
}

describe("SessionController model catalog", () => {
  it("targets the selected machine when listing the catalog", async () => {
    const calls: { sessionId: string; machineId: string }[] = [];
    const state: AppState = { ...initialAppState(), selectedMachine: machine("remote-a"), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api = {
      modelCatalog: (session, machineId) => {
        calls.push({ sessionId: sessionLookupId(session), machineId: machineId ?? "local" });
        return Promise.resolve({ models: catalogModels });
      },
    } satisfies Partial<typeof defaultApi>;
    const { controller } = createSessionControllerTestFixture({ initialState: state, api });

    expect(await controller.listModelCatalog()).toEqual(catalogModels);
    expect(calls).toEqual([{ sessionId: oldSession.id, machineId: "remote-a" }]);
  });

  it("returns a fresh catalog after toggling one model", async () => {
    const calls: { provider: string; modelId: string; enabled: boolean; machineId: string }[] = [];
    const state: AppState = { ...initialAppState(), selectedMachine: machine("remote-a"), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api = {
      setModelEnabled: (_session, provider, modelId, enabled, machineId) => {
        calls.push({ provider, modelId, enabled, machineId: machineId ?? "local" });
        return Promise.resolve({ models: catalogModels.map((model) => model.id === modelId ? { ...model, enabled } : model) });
      },
    } satisfies Partial<typeof defaultApi>;
    const { controller } = createSessionControllerTestFixture({ initialState: state, api });

    const models = await controller.setModelEnabled("openai", "gpt-4o", true);

    expect(models?.find((model) => model.id === "gpt-4o")?.enabled).toBe(true);
    expect(calls).toEqual([{ provider: "openai", modelId: "gpt-4o", enabled: true, machineId: "remote-a" }]);
  });

  it("reports request failures and avoids calls without a selected session", async () => {
    const state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const failingApi = { setModelEnabled: () => Promise.reject(new Error("toggle failed")) } satisfies Partial<typeof defaultApi>;
    const failing = createSessionControllerTestFixture({ initialState: state, api: failingApi });

    expect(await failing.controller.setModelEnabled("openai", "gpt-4o", true)).toBeUndefined();
    expect(Object.values(failing.state.browserErrors).map((error) => error.message)).toContain("Error: toggle failed");

    const unusedApi = { modelCatalog: () => { throw new Error("must not be called"); } } satisfies Partial<typeof defaultApi>;
    const unused = createSessionControllerTestFixture({ initialState: initialAppState(), api: unusedApi });
    expect(await unused.controller.listModelCatalog()).toEqual([]);
  });
});
