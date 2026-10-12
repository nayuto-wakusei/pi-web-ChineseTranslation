// @vitest-environment happy-dom

import { render, type TemplateResult } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { Machine, MachineRuntime, PiWebDeprecatedAgentInput } from "../api";
import { deprecatedAgentInputsBanner, deprecatedAgentInputsWarnings, deprecatedAgentInputsWarningText, type DeprecatedAgentInputsWarning } from "./deprecatedAgentInputsBanner";

afterEach(() => {
  document.body.replaceChildren();
});

describe("deprecatedAgentInputsWarnings", () => {
  it("attributes each warning to its machine in machine-list order", () => {
    const machines = [machine("local", "Local", "local"), machine("remote-a", "Spare"), machine("remote-b", "Build box")];
    const runtimes = {
      // Record order deliberately differs from machine-list order.
      "remote-b": runtimeWithInputs([{ source: "environment", name: "PI_WEB_AGENT_DIR", replacement: "PI_CODING_AGENT_DIR" }]),
      "local": runtimeWithInputs([{ source: "config", name: "agent.dir", replacement: "PI_CODING_AGENT_DIR" }]),
      "remote-a": runtimeWithInputs(undefined),
    };

    const warnings = deprecatedAgentInputsWarnings(machines, runtimes);

    expect(warnings.map((warning) => warning.machineId)).toEqual(["local", "remote-b"]);
    expect(warnings.map((warning) => warning.machineName)).toEqual(["Local", "Build box"]);
  });

  it("skips machines whose runtime failed or reported no deprecated inputs", () => {
    const machines = [machine("local", "Local", "local"), machine("remote-a", "Build box")];
    const runtimes = {
      "local": runtimeWithInputs([]),
      "remote-a": { machineId: "remote-a", ok: false, checkedAt: "now", error: "offline" },
    };

    expect(deprecatedAgentInputsWarnings(machines, runtimes)).toEqual([]);
  });
});

describe("deprecatedAgentInputsWarningText", () => {
  it("names the machine, each deprecated input, its replacement, and the removal notice", () => {
    const text = deprecatedAgentInputsWarningText(warning("Build box", [
      { source: "environment", name: "PI_WEB_AGENT_DIR", replacement: "PI_CODING_AGENT_DIR" },
      { source: "config", name: "agent.dir", replacement: "PI_CODING_AGENT_DIR" },
    ]));

    expect(text).toBe("Build box：环境变量 PI_WEB_AGENT_DIR 已弃用；请改用 PI_CODING_AGENT_DIR；配置项 agent.dir 已弃用；请改用 PI_CODING_AGENT_DIR。对弃用代理配置输入的支持将在未来版本中移除。");
  });

  it("tells the user to remove inputs that have no replacement", () => {
    const text = deprecatedAgentInputsWarningText(warning("Local", [
      { source: "environment", name: "PI_WEB_AGENT_COMMAND" },
      { source: "config", name: "agent.command" },
    ]));

    expect(text).toContain("环境变量 PI_WEB_AGENT_COMMAND 已弃用；没有替代项，请手动移除（本地兼容行为暂时保留）");
    expect(text).toContain("配置项 agent.command 已弃用；没有替代项，请手动移除（本地兼容行为暂时保留）");
    expect(text).toContain("将在未来版本中移除");
  });
});

describe("deprecatedAgentInputsBanner", () => {
  it("renders nothing when no machine reports a deprecated input", () => {
    const container = renderInto(deprecatedAgentInputsBanner([]));

    expect(container.querySelector(".deprecation-notice")).toBeNull();
  });

  it("renders one non-dismissable alert line per warned machine", () => {
    const warnings = [
      warning("Local", [{ source: "environment", name: "PI_WEB_AGENT_DIR", replacement: "PI_CODING_AGENT_DIR" }]),
      warning("Build box", [{ source: "config", name: "agent.command" }]),
    ];

    const container = renderInto(deprecatedAgentInputsBanner(warnings));

    const notice = container.querySelector(".deprecation-notice");
    expect(notice?.getAttribute("role")).toBe("alert");
    const lines = [...(notice?.querySelectorAll(".deprecation-notice-text") ?? [])].map((line) => line.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Local");
    expect(lines[1]).toContain("Build box");
    // Non-dismissable by contract: no dismiss control of any kind.
    expect(notice?.querySelector("button, [role='button'], a")).toBeNull();
  });
});

function machine(id: string, name: string, kind: Machine["kind"] = "remote"): Machine {
  return { id, name, kind, createdAt: "2026-05-25T00:00:00.000Z", updatedAt: "2026-05-25T00:00:00.000Z" };
}

function runtimeWithInputs(deprecatedAgentInputs: readonly PiWebDeprecatedAgentInput[] | undefined): MachineRuntime {
  return { machineId: "machine", ok: true, checkedAt: "now", ...(deprecatedAgentInputs === undefined ? {} : { deprecatedAgentInputs }) };
}

function warning(machineName: string, inputs: readonly PiWebDeprecatedAgentInput[]): DeprecatedAgentInputsWarning {
  return { machineId: machineName.toLowerCase(), machineName, inputs };
}

function renderInto(template: TemplateResult | null): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(template ?? null, container);
  return container;
}

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
