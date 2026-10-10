// @vitest-environment happy-dom
import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { deprecatedAgentInputsBanner, deprecatedAgentInputsWarnings, deprecatedAgentInputsWarningText } from "./deprecatedAgentInputsBanner";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

describe("deprecated agent input banner", () => {
  it("attributes live reports in machine-list order and ignores unknown machines", () => {
    const machines = [{ id: "local", name: "本机", kind: "local" as const, createdAt: "now", updatedAt: "now" }, { id: "remote", name: "远端", kind: "remote" as const, createdAt: "now", updatedAt: "now" }];
    const inputs = [{ source: "config" as const, name: "agent.command" }];
    expect(deprecatedAgentInputsWarnings(machines, {
      remote: { machineId: "remote", checkedAt: "now", ok: true, deprecatedAgentInputs: inputs },
      missing: { machineId: "missing", checkedAt: "now", ok: true, deprecatedAgentInputs: inputs },
    })).toEqual([{ machineId: "remote", machineName: "远端", inputs }]);
    expect(deprecatedAgentInputsWarnings(machines, {})).toEqual([]);
  });

  it("renders an attributed, non-dismissable Chinese alert with honest compatibility guidance", () => {
    const warning = { machineId: "remote", machineName: "远端", inputs: [{ source: "config" as const, name: "agent.command" }, { source: "environment" as const, name: "PI_WEB_AGENT_DIR", replacement: "PI_CODING_AGENT_DIR" }] };
    render(deprecatedAgentInputsBanner([warning]), document.body);
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(deprecatedAgentInputsWarningText(warning));
    expect(alert?.textContent).toContain("本地兼容行为暂时保留");
    expect(alert?.textContent).toContain("PI_CODING_AGENT_DIR");
    expect(alert?.querySelector("button")).toBeNull();
    expect(deprecatedAgentInputsBanner([])).toBeNull();
  });
});
