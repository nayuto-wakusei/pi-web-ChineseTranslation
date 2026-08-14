import { describe, expect, it } from "vitest";
import { sessionEnvironmentFacts, sessionEnvironmentPromptSections } from "./sessionEnvironmentFacts.js";

describe("session environment facts", () => {
  it("describes the hosting instance without exposing credentials", () => {
    const facts = sessionEnvironmentFacts({ env: { PI_WEB_DATA_DIR: "/tmp/pi-web", PI_WEB_SESSIOND_SOCKET: "/tmp/pi-web/sessiond.sock" } });
    expect(facts).toContain("<pi_web_session_environment>");
    expect(facts).toContain("/tmp/pi-web");
    expect(facts).not.toContain("PI_WEB_AUDIT_ES_PASSWORD");
  });

  it("can disable prompt additions", () => {
    expect(sessionEnvironmentPromptSections({ env: {}, enabled: false })).toEqual([]);
  });
});
