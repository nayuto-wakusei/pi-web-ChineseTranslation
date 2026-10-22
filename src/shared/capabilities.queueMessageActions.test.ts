import { expect, it } from "vitest";
import { effectivePiWebCapabilities, PI_WEB_CAPABILITIES, parseKnownPiWebCapabilities, SESSIOND_RUNTIME_CAPABILITIES, WEB_RUNTIME_CAPABILITIES } from "./capabilities";

it("advertises queue mutation only when both gateway and daemon support it", () => {
  const capability = PI_WEB_CAPABILITIES.sessionsQueueMessageActions;
  expect(WEB_RUNTIME_CAPABILITIES).toContain(capability);
  expect(SESSIOND_RUNTIME_CAPABILITIES).toContain(capability);
  expect(parseKnownPiWebCapabilities([capability, "future.capability"])).toEqual([capability]);
  for (const web of [false, true]) for (const daemon of [false, true]) {
    const effective = effectivePiWebCapabilities({
      web: { available: true, capabilities: web ? [capability] : [] },
      sessiond: { available: true, capabilities: daemon ? [capability] : [] },
    });
    expect(effective.includes(capability)).toBe(web && daemon);
  }
  expect(effectivePiWebCapabilities({ web: { available: true, capabilities: [capability] }, sessiond: { available: false, capabilities: [capability] } })).not.toContain(capability);
});
