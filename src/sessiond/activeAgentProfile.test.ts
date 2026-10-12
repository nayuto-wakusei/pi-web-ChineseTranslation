import { describe, expect, it } from "vitest";
import type { EffectivePiWebAgentConfig } from "../config.js";
import { createActiveAgentProfileDescriptor, publicActiveAgentProfileDescriptor } from "./activeAgentProfile.js";

const baseAgent: EffectivePiWebAgentConfig = {
  command: "acme-agent",
  dir: "/opt/pi/state",
  sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR"],
};

describe("active agent profile descriptor", () => {
  it("publishes only upstream v2 fields while retaining local runtime metadata", () => {
    const profile = createActiveAgentProfileDescriptor(baseAgent);
    expect(publicActiveAgentProfileDescriptor(profile)).toEqual({ schemaVersion: 2, dir: baseAgent.dir });
    expect(profile.command).toBe(baseAgent.command);
    expect(profile.sessionDirEnvKeys).toEqual(baseAgent.sessionDirEnvKeys);
  });
  it("builds a stable revision from every effective profile field", () => {
    const first = createActiveAgentProfileDescriptor(baseAgent);
    const second = createActiveAgentProfileDescriptor({ ...baseAgent, sessionDirEnvKeys: [...baseAgent.sessionDirEnvKeys] });

    expect(second).toEqual(first);
    expect(first.revision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(createActiveAgentProfileDescriptor({ ...baseAgent, command: "other-agent" }).revision).not.toBe(first.revision);
    expect(createActiveAgentProfileDescriptor({ ...baseAgent, dir: "/other/state" }).revision).not.toBe(first.revision);
    expect(createActiveAgentProfileDescriptor({ ...baseAgent, sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"] }).revision).not.toBe(first.revision);
  });

  it("takes an immutable snapshot for the session daemon profile epoch", () => {
    const profile = createActiveAgentProfileDescriptor(baseAgent);

    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.sessionDirEnvKeys)).toBe(true);
    expect(Reflect.set(profile, "dir", "/mutated/state")).toBe(false);
    expect(profile.dir).toBe(baseAgent.dir);
  });

  it("rejects a state directory that is not valid for this host", () => {
    expect(() => createActiveAgentProfileDescriptor({ ...baseAgent, dir: "relative/state" })).toThrow("must be valid for this host");
    expect(() => createActiveAgentProfileDescriptor({ ...baseAgent, dir: "" })).toThrow("must be valid for this host");
    expect(() => createActiveAgentProfileDescriptor({ ...baseAgent, command: "./acme-agent" })).toThrow("must be valid for this host");
    expect(() => createActiveAgentProfileDescriptor({ ...baseAgent, sessionDirEnvKeys: ["ARBITRARY_AGENT_SESSION_DIR"] })).toThrow("explicit PI WEB policy");
  });

  it("copies only the secret-free descriptor fields", () => {
    const input = {
      ...baseAgent,
      token: "must-not-cross-the-protocol",
      auth: { apiKey: "also-secret" },
    };

    const profile = publicActiveAgentProfileDescriptor(createActiveAgentProfileDescriptor(input));

    expect(profile).toEqual({ schemaVersion: 2, dir: baseAgent.dir });
    expect(JSON.stringify(profile)).not.toContain("secret");
  });
});
