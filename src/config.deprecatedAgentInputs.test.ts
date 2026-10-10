import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDeprecatedAgentInputs, effectivePiWebConfig, loadPiWebConfig, savePiWebConfig } from "./config.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "pi-web-deprecated-inputs-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("deprecated agent input diagnostics", () => {
  it("reports only input names and canonical replacements, never configured values", () => {
    const inputs = detectDeprecatedAgentInputs({ PI_WEB_AGENT_COMMAND: "private-command", PI_WEB_AGENT_DIR: "private-directory", PI_WEB_AGENT_SESSION_DIR: "private-sessions" }, { agent: { command: "private-alias", dir: "private-config-dir" } });
    expect(inputs).toEqual([
      { source: "environment", name: "PI_WEB_AGENT_COMMAND" },
      { source: "environment", name: "PI_WEB_AGENT_DIR", replacement: "PI_CODING_AGENT_DIR" },
      { source: "environment", name: "PI_WEB_AGENT_SESSION_DIR", replacement: "PI_CODING_AGENT_SESSION_DIR" },
      { source: "config", name: "agent.command" },
      { source: "config", name: "agent.dir", replacement: "PI_CODING_AGENT_DIR" },
    ]);
    expect(JSON.stringify(inputs)).not.toContain("private-");
    expect(detectDeprecatedAgentInputs({ PI_WEB_AGENT_COMMAND: "", PI_CODING_AGENT_DIR: "canonical" })).toEqual([]);
  });

  it("reports process inputs even when no file exists and clears file reports after an edit", async () => {
    const path = join(directory, "config.json");
    const env = { PI_WEB_CONFIG: path, PI_WEB_AGENT_SESSION_DIR: "private-sessions" };
    expect(loadPiWebConfig({ env }).deprecatedAgentInputs).toEqual([{ source: "environment", name: "PI_WEB_AGENT_SESSION_DIR", replacement: "PI_CODING_AGENT_SESSION_DIR" }]);
    await writeFile(path, JSON.stringify({ agent: { command: "pi" } }));
    expect(loadPiWebConfig({ env }).deprecatedAgentInputs).toHaveLength(2);
    await writeFile(path, "{}");
    expect(loadPiWebConfig({ env }).deprecatedAgentInputs).toHaveLength(1);
  });

  it("preserves local command compatibility and does not automatically migrate user configuration", async () => {
    const path = join(directory, "config.json");
    const config = { agent: { command: "pi", dir: directory } };
    const env = { PI_WEB_CONFIG: path };
    const saved = savePiWebConfig(config, { env });
    expect(saved.deprecatedAgentInputs).toHaveLength(2);
    expect(effectivePiWebConfig({ env }).config.agent.command).toBe("pi");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config);
  });
});
