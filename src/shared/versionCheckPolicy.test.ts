import { describe, expect, it } from "vitest";
import { versionChecksDisabled } from "./versionCheckPolicy.js";

describe("version-check environment policy", () => {
  it("uses strict booleans for every legacy alias", () => {
    expect(versionChecksDisabled({})).toBe(false);
    expect(versionChecksDisabled({ PI_WEB_SKIP_VERSION_CHECK: "FALSE", PI_OFFLINE: "0" })).toBe(false);
    expect(versionChecksDisabled({ PI_SKIP_VERSION_CHECK: "TrUe" })).toBe(true);
    expect(versionChecksDisabled({ PI_OFFLINE: "1" })).toBe(true);
    expect(() => versionChecksDisabled({ PI_WEB_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "no" })).toThrow("PI_SKIP_VERSION_CHECK");
    expect(() => versionChecksDisabled({ PI_WEB_SKIP_VERSION_CHECK: "" })).toThrow("PI_WEB_SKIP_VERSION_CHECK");
  });
});
