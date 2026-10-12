import { describe, expect, it } from "vitest";
import { effectivePiWebCapabilities, isPiWebCapability, PI_WEB_CAPABILITIES, SESSIOND_RUNTIME_CAPABILITIES, WEB_RUNTIME_CAPABILITIES, parseKnownPiWebCapabilities } from "./capabilities";

describe("PI WEB capabilities", () => {
  it("advertises web-only capabilities without requiring session daemon support", () => {
    expect(WEB_RUNTIME_CAPABILITIES).toContain(PI_WEB_CAPABILITIES.piPackagesManage);
    expect(WEB_RUNTIME_CAPABILITIES).toContain(PI_WEB_CAPABILITIES.selectedMachineSettings);
    expect(WEB_RUNTIME_CAPABILITIES).toContain(PI_WEB_CAPABILITIES.agentProfileConfig);
    expect(SESSIOND_RUNTIME_CAPABILITIES).not.toContain(PI_WEB_CAPABILITIES.piPackagesManage);
    expect(SESSIOND_RUNTIME_CAPABILITIES).not.toContain(PI_WEB_CAPABILITIES.selectedMachineSettings);
    expect(SESSIOND_RUNTIME_CAPABILITIES).not.toContain(PI_WEB_CAPABILITIES.agentProfileConfig);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [PI_WEB_CAPABILITIES.piPackagesManage, PI_WEB_CAPABILITIES.selectedMachineSettings, PI_WEB_CAPABILITIES.agentProfileConfig] },
      sessiond: { available: false, capabilities: [] },
    })).toEqual([PI_WEB_CAPABILITIES.piPackagesManage, PI_WEB_CAPABILITIES.selectedMachineSettings, PI_WEB_CAPABILITIES.agentProfileConfig]);
  });

  it("requires web and session daemon support for authoritative session persistence", () => {
    expect(WEB_RUNTIME_CAPABILITIES).toContain(PI_WEB_CAPABILITIES.sessionsPersistedState);
    expect(SESSIOND_RUNTIME_CAPABILITIES).toContain(PI_WEB_CAPABILITIES.sessionsPersistedState);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsPersistedState] },
      sessiond: { available: false, capabilities: [PI_WEB_CAPABILITIES.sessionsPersistedState] },
    })).not.toContain(PI_WEB_CAPABILITIES.sessionsPersistedState);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsPersistedState] },
      sessiond: { available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsPersistedState] },
    })).toContain(PI_WEB_CAPABILITIES.sessionsPersistedState);
  });

  it("requires web and session daemon support for server-side queue clearing", () => {
    const clearQueue = PI_WEB_CAPABILITIES.sessionsClearQueue;
    expect(WEB_RUNTIME_CAPABILITIES).toContain(clearQueue);
    expect(SESSIOND_RUNTIME_CAPABILITIES).toContain(clearQueue);
    expect(parseKnownPiWebCapabilities([clearQueue, "future.capability"])).toEqual([clearQueue]);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [clearQueue] },
      sessiond: { available: true, capabilities: [] },
    })).not.toContain(clearQueue);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [] },
      sessiond: { available: true, capabilities: [clearQueue] },
    })).not.toContain(clearQueue);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [clearQueue] },
      sessiond: { available: true, capabilities: [clearQueue] },
    })).toContain(clearQueue);
  });

  it("requires both web and session daemon support for notification inboxes", () => {
    const notifications = PI_WEB_CAPABILITIES.sessionsNotifications;
    expect(WEB_RUNTIME_CAPABILITIES).toContain(notifications);
    expect(SESSIOND_RUNTIME_CAPABILITIES).toContain(notifications);
    expect(parseKnownPiWebCapabilities([notifications, "future.capability"])).toEqual([notifications]);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [notifications] },
      sessiond: { available: true, capabilities: [] },
    })).not.toContain(notifications);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [] },
      sessiond: { available: true, capabilities: [notifications] },
    })).not.toContain(notifications);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [notifications] },
      sessiond: { available: true, capabilities: [notifications] },
    })).toContain(notifications);
  });

  it("negotiates daemon-authoritative unread state only when both runtimes support it", () => {
    const unread = PI_WEB_CAPABILITIES.sessionsUnread;
    expect(WEB_RUNTIME_CAPABILITIES).toContain(unread);
    expect(SESSIOND_RUNTIME_CAPABILITIES).toContain(unread);
    expect(parseKnownPiWebCapabilities([unread, "future.capability"])).toEqual([unread]);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [unread] },
      sessiond: { available: true, capabilities: [] },
    })).not.toContain(unread);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [] },
      sessiond: { available: true, capabilities: [unread] },
    })).not.toContain(unread);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [unread] },
      sessiond: { available: true, capabilities: [unread] },
    })).toContain(unread);
  });

  it("renders the question card only when both runtimes support daemon-owned asks", () => {
    const askUser = PI_WEB_CAPABILITIES.sessionsAskUser;
    expect(WEB_RUNTIME_CAPABILITIES).toContain(askUser);
    expect(SESSIOND_RUNTIME_CAPABILITIES).toContain(askUser);
    expect(parseKnownPiWebCapabilities([askUser, "future.capability"])).toEqual([askUser]);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [askUser] },
      sessiond: { available: true, capabilities: [] },
    })).not.toContain(askUser);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [] },
      sessiond: { available: true, capabilities: [askUser] },
    })).not.toContain(askUser);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [askUser] },
      sessiond: { available: true, capabilities: [askUser] },
    })).toContain(askUser);
  });

  it("keeps only known string capabilities when parsing runtime data", () => {
    expect(parseKnownPiWebCapabilities([PI_WEB_CAPABILITIES.piPackagesManage, PI_WEB_CAPABILITIES.selectedMachineSettings, "future.capability"])).toEqual([PI_WEB_CAPABILITIES.piPackagesManage, PI_WEB_CAPABILITIES.selectedMachineSettings]);
    expect(parseKnownPiWebCapabilities([PI_WEB_CAPABILITIES.piPackagesManage, 1])).toBeUndefined();
  });
});

describe("upstream plugin lifecycle with local rolling-version capabilities", () => {
  it("advertises plugin lifecycle as a web-only capability that does not require session daemon support", () => {
    expect(WEB_RUNTIME_CAPABILITIES).toEqual(Object.values(PI_WEB_CAPABILITIES));
    expect(WEB_RUNTIME_CAPABILITIES).toContain(PI_WEB_CAPABILITIES.pluginLifecycle);
    expect(SESSIOND_RUNTIME_CAPABILITIES).not.toContain(PI_WEB_CAPABILITIES.pluginLifecycle);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [PI_WEB_CAPABILITIES.pluginLifecycle] },
      sessiond: { available: false, capabilities: [] },
    })).toEqual([PI_WEB_CAPABILITIES.pluginLifecycle]);
  });

  it("computes no effective capabilities when the registry entry is not advertised", () => {
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: [] },
      sessiond: { available: true, capabilities: [] },
    })).toEqual([]);
  });

  it("parses only current capability strings from runtime data", () => {
    expect(parseKnownPiWebCapabilities(["plugins.lifecycle", "piPackages.manage", "future.capability"])).toEqual(["plugins.lifecycle", "piPackages.manage"]);
    expect(parseKnownPiWebCapabilities(["future.capability", 1])).toBeUndefined();
    expect(isPiWebCapability("plugins.lifecycle")).toBe(true);
    expect(isPiWebCapability("piPackages.manage")).toBe(true);
    expect(isPiWebCapability("future.capability")).toBe(false);
  });
});
