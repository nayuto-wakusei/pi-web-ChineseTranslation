import { describe, expect, it } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { MachineStatusController } from "./machineStatusController";

const snapshot = (epochId: string, revision: number): MachineStatusSnapshot => ({ epochId, revision, machine: { "core:working": true }, projects: {}, workspaces: {}, unattributed: {}, generatedAt: "now" });

describe("MachineStatusController", () => {
  it("accepts newer revisions and ignores older frames", () => {
    let state: AppState = initialAppState();
    const controller = new MachineStatusController(() => state, (patch) => { state = { ...state, ...patch }; });
    controller.apply("local", snapshot("epoch", 2));
    controller.apply("local", snapshot("epoch", 1));
    expect(state.machineStatusSnapshots["local"]?.revision).toBe(2);
  });

  it("replaces a snapshot when the daemon epoch changes", () => {
    let state: AppState = initialAppState();
    const controller = new MachineStatusController(() => state, (patch) => { state = { ...state, ...patch }; });
    controller.apply("local", snapshot("old", 99));
    controller.apply("local", snapshot("new", 1));
    expect(state.machineStatusSnapshots["local"]).toMatchObject({ epochId: "new", revision: 1 });
  });
});
