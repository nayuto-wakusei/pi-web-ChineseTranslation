import { describe, expect, it } from "vitest";
import { isAgentVisibleEnvKey, scrubNonAgentVisibleEnvKeys } from "./agentProcessEnvironment.js";

describe("agent process environment", () => {
  it("scrubs only NODE_ENV and PORT while preserving PI WEB wiring", () => {
    const env = {
      NODE_ENV: "production",
      PORT: "8500",
      PI_WEB_DATA_DIR: "/tmp/pi-web",
      PI_WEB_SESSIOND_SOCKET: "/tmp/pi-web/sessiond.sock",
      PI_CODING_AGENT_DIR: "/tmp/pi-agent",
      PATH: "/usr/bin",
    };

    expect(scrubNonAgentVisibleEnvKeys(env)).toEqual(["NODE_ENV", "PORT"]);
    expect(env).toEqual({
      PI_WEB_DATA_DIR: "/tmp/pi-web",
      PI_WEB_SESSIOND_SOCKET: "/tmp/pi-web/sessiond.sock",
      PI_CODING_AGENT_DIR: "/tmp/pi-agent",
      PATH: "/usr/bin",
    });
    expect(isAgentVisibleEnvKey("PI_WEB_NEW_SETTING")).toBe(true);
  });
});
