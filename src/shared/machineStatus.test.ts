import { describe, expect, it } from "vitest";
import { parseMachineStatusSnapshot, rollUpStatusFlags } from "./machineStatus";

describe("machine status contract", () => {
  it("rolls up only set flags", () => {
    expect(rollUpStatusFlags([{ "core:working": true }, { "core:working": false, "core:terminal": true }])).toEqual({ "core:working": true, "core:terminal": true });
  });

  it("tolerates unknown and malformed individual flags without accepting malformed structure", () => {
    const snapshot = parseMachineStatusSnapshot({
      epochId: "epoch",
      revision: 2,
      generatedAt: "now",
      machine: { "core:working": true, future: "ignored" },
      projects: { project: { future: true } },
      workspaces: {},
      unattributed: {},
    });
    expect(snapshot?.machine).toEqual({ "core:working": true });
    expect(snapshot?.projects).toEqual({ project: { future: true } });
    expect(parseMachineStatusSnapshot({ epochId: "", revision: 1, generatedAt: "now", machine: {}, projects: {}, workspaces: {}, unattributed: {} })).toBeUndefined();
  });
});
