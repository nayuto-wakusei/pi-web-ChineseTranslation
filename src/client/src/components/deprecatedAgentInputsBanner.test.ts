// @vitest-environment happy-dom

import { LitElement, render, type TemplateResult } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { Machine, MachineRuntime, PiWebDeprecatedAgentInput } from "../api";
import { localization, LocalizationController } from "../localization/browser";
import { deprecatedAgentInputsBanner, deprecatedAgentInputsWarnings, deprecatedAgentInputsWarningText, type DeprecatedAgentInputsWarning } from "./deprecatedAgentInputsBanner";

const releases: (() => void)[] = [];
afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
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

    expect(text).toBe("Build box: environment variable PI_WEB_AGENT_DIR is deprecated; set PI_CODING_AGENT_DIR instead, config key agent.dir is deprecated; set PI_CODING_AGENT_DIR instead. Support for deprecated agent configuration inputs will be removed in a future release.");
  });

  it("tells the user to remove inputs that have no replacement", () => {
    const text = deprecatedAgentInputsWarningText(warning("Local", [
      { source: "environment", name: "PI_WEB_AGENT_COMMAND" },
      { source: "config", name: "agent.command" },
    ]));

    expect(text).toContain("environment variable PI_WEB_AGENT_COMMAND is deprecated with no replacement; remove it manually (local compatibility remains temporarily)");
    expect(text).toContain("config key agent.command is deprecated with no replacement; remove it manually (local compatibility remains temporarily)");
    expect(text).toContain("will be removed in a future release");
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

// The app owns localization invalidation; the banner is a stateless template.
class BannerHost extends LitElement {
  constructor(readonly warnings: readonly DeprecatedAgentInputsWarning[] = []) {
    super();
    new LocalizationController(this);
  }
  override render() { return deprecatedAgentInputsBanner(this.warnings); }
}
customElements.define("test-deprecated-inputs-banner", BannerHost);

it("updates the complete banner without changing machine reports or interpreting identifiers as markup", async () => {
  releases.push(localization.registerCatalog({ id: "deprecated-inputs-test", namespace: "core.deprecatedAgentInputs", locale: "de", load: () => Promise.resolve({
    warning: "{machine}: {inputs}. Die Unterstützung endet in einer künftigen Version.",
    configReplacement: "Konfigurationsschlüssel {name} ist veraltet; stattdessen {replacement} setzen",
    environmentReplacement: "Umgebungsvariable {name} ist veraltet; stattdessen {replacement} setzen",
    configCompatibility: "Konfigurationsschlüssel {name} ist veraltet; Kompatibilität bleibt vorübergehend erhalten",
    environmentCompatibility: "Umgebungsvariable {name} ist veraltet; Kompatibilität bleibt vorübergehend erhalten",
  }) }));
  const report = warning("<b>Build box</b>", [
    { source: "config", name: "agent.dir", replacement: "PI_CODING_AGENT_DIR" },
    { source: "environment", name: "PI_WEB_AGENT_DIR", replacement: "PI_CODING_AGENT_DIR" },
    { source: "config", name: "agent.command" },
    { source: "environment", name: "PI_WEB_AGENT_COMMAND" },
  ]);
  const reports = [report];
  await localization.setPreferences({ language: "en", formatLocale: "de-DE" });
  const host = new BannerHost(reports);
  document.body.append(host);
  await host.updateComplete;
  const alert = host.shadowRoot?.querySelector('[role="alert"]');
  const english = alert?.textContent;
  for (const language of ["de", "en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "de-DE" });
    await host.updateComplete;
    expect(host.shadowRoot?.querySelector('[role="alert"]')).toBe(alert);
    expect(alert?.textContent).toContain(deprecatedAgentInputsWarningText(report));
    for (const value of ["<b>Build box</b>", "agent.dir", "PI_CODING_AGENT_DIR", "PI_WEB_AGENT_DIR", "agent.command", "PI_WEB_AGENT_COMMAND"]) expect(alert?.textContent).toContain(value);
    expect(alert?.querySelector("b, button, a")).toBeNull();
    expect(host.warnings).toBe(reports);
    if (language === "en") expect(alert?.textContent).toBe(english);
    else expect(alert?.textContent).not.toBe(english);
    if (language === "de") {
      expect(alert?.textContent).toContain("Konfigurationsschlüssel agent.dir ist veraltet");
      expect(alert?.textContent).toContain("Umgebungsvariable PI_WEB_AGENT_DIR ist veraltet");
      expect(alert?.textContent).toContain("Konfigurationsschlüssel agent.command ist veraltet");
      expect(alert?.textContent).toContain("Umgebungsvariable PI_WEB_AGENT_COMMAND ist veraltet");
      expect(alert?.textContent).toContain("Die Unterstützung endet");
    }
  }
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
    const machines = [{ id: "local", name: "Local", kind: "local" as const, createdAt: "now", updatedAt: "now" }, { id: "remote", name: "远端", kind: "remote" as const, createdAt: "now", updatedAt: "now" }];
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
    expect(alert?.textContent).toContain("local compatibility remains temporarily");
    expect(alert?.textContent).toContain("PI_CODING_AGENT_DIR");
    expect(alert?.querySelector("button")).toBeNull();
    expect(deprecatedAgentInputsBanner([])).toBeNull();
  });
});
