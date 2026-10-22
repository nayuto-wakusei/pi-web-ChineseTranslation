import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { updateCommandFor } from "./piWebStatus.js";
import type { PiWebInstallationInfo } from "../shared/apiTypes.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const profile = (dir: string) => ({ schemaVersion: 2 as const, dir });

describe("installation-aware update recommendations", () => {
  it.each(["local", "npm-global", "pi-package"] as const)("pins %s recommendations to this node and the absolute installation CLI", (kind) => {
    const path = resolve("installation's space");
    const dir = resolve("profile's state");
    const command = updateCommandFor({ kind, path }, { activeAgentProfile: profile(dir) });
    expect(command).toBe(`PI_CODING_AGENT_DIR=${quote(dir)} ${quote(process.execPath)} ${quote(join(path, "dist", "cli.js"))} update`);
    expect(command).not.toContain("npm install");
    expect(command).not.toContain("pi update");
    expect(command).not.toContain("&&");
  });

  it("allows npm and checkout CLI preflight without inventing a profile", () => {
    const path = resolve("installation");
    for (const kind of ["local", "npm-global"] as const) {
      expect(updateCommandFor({ kind, path }, { activeAgentProfile: undefined }))
        .toBe(`${quote(process.execPath)} ${quote(join(path, "dist", "cli.js"))} update`);
    }
  });

  it("does not inherit an ambient profile for Pi package updates", () => {
    expect(updateCommandFor({ kind: "pi-package", path: resolve("installation") }, { activeAgentProfile: undefined })).toBeUndefined();
  });

  it.each([
    undefined,
    { kind: "unknown" },
    { kind: "npm-global" },
    { kind: "local", path: "relative/checkout" },
    { kind: "npm-global", path: "" },
  ] satisfies (PiWebInstallationInfo | undefined)[])("does not recommend updates for unresolved installation %j", (installation) => {
    expect(updateCommandFor(installation, { activeAgentProfile: undefined })).toBeUndefined();
  });

  it("fails closed for an unsafe active profile", () => {
    expect(updateCommandFor({ kind: "local", path: resolve("installation") }, { activeAgentProfile: profile("relative/state") })).toBeUndefined();
  });
});
