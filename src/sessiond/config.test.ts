import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sessiondSocketPath } from "./config.js";

describe("session daemon socket environment", () => {
  it("uses the captured socket override instead of the mutable process environment", () => {
    expect(sessiondSocketPath({ PI_WEB_SESSIOND_SOCKET: "isolated.sock" })).toBe("isolated.sock");
  });

  it("resolves the default socket from the same captured data directory", () => {
    const dataDir = resolve("isolated-data");
    expect(sessiondSocketPath({ PI_WEB_DATA_DIR: dataDir })).toBe(join(dataDir, "sessiond.sock"));
  });
});
