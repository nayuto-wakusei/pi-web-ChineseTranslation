import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, sessionLookupId, workspace, type AppState } from "./sessionController.testSupport";

const catalogModels = [
  { provider: "openai", id: "gpt-5", enabled: true },
  { provider: "anthropic", id: "claude-sonnet-4-5", enabled: true },
  { provider: "openai", id: "gpt-4o", enabled: false },
];

function machine(id: string): NonNullable<AppState["selectedMachine"]> {
  return { id, name: id, kind: "remote", createdAt: "now", updatedAt: "now" };
}

function controllerWithApi(state: AppState, setState: (patch: Partial<AppState>) => void, api: typeof defaultApi): SessionController {
  return new SessionController(
    () => state,
    setState,
    () => undefined,
    undefined,
    { api, socket: new FakeSocket() },
  );
}

describe("SessionController model catalog", () => {
  it("targets the selected machine when listing the catalog", async () => {
    const calls: { sessionId: string; machineId: string }[] = [];
    let state: AppState = { ...initialAppState(), selectedMachine: machine("remote-a"), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      modelCatalog: (session, machineId) => {
        calls.push({ sessionId: sessionLookupId(session), machineId: machineId ?? "local" });
        return Promise.resolve({ models: catalogModels });
      },
    };
    const controller = controllerWithApi(state, (patch) => { state = { ...state, ...patch }; }, api);

    expect(await controller.listModelCatalog()).toEqual(catalogModels);
    expect(calls).toEqual([{ sessionId: oldSession.id, machineId: "remote-a" }]);
  });

  it("returns a fresh catalog after toggling one model", async () => {
    const calls: { provider: string; modelId: string; enabled: boolean; machineId: string }[] = [];
    let state: AppState = { ...initialAppState(), selectedMachine: machine("remote-a"), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      setModelEnabled: (_session, provider, modelId, enabled, machineId) => {
        calls.push({ provider, modelId, enabled, machineId: machineId ?? "local" });
        return Promise.resolve({ models: catalogModels.map((model) => model.id === modelId ? { ...model, enabled } : model) });
      },
    };
    const controller = controllerWithApi(state, (patch) => { state = { ...state, ...patch }; }, api);

    const models = await controller.setModelEnabled("openai", "gpt-4o", true);

    expect(models?.find((model) => model.id === "gpt-4o")?.enabled).toBe(true);
    expect(calls).toEqual([{ provider: "openai", modelId: "gpt-4o", enabled: true, machineId: "remote-a" }]);
  });

  it("reports request failures and avoids calls without a selected session", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const failingApi: typeof defaultApi = { ...defaultApi, setModelEnabled: () => Promise.reject(new Error("toggle failed")) };
    const failing = controllerWithApi(state, (patch) => { state = { ...state, ...patch }; }, failingApi);

    expect(await failing.setModelEnabled("openai", "gpt-4o", true)).toBeUndefined();
    expect(state.error).toBe("Error: toggle failed");

    state = initialAppState();
    const unusedApi: typeof defaultApi = { ...defaultApi, modelCatalog: () => { throw new Error("must not be called"); } };
    const unused = controllerWithApi(state, (patch) => { state = { ...state, ...patch }; }, unusedApi);
    expect(await unused.listModelCatalog()).toEqual([]);
  });
});
