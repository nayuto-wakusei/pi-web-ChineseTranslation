import { describe, expect, it } from "vitest";
import { parsePiWebConfig, parsePiWebConfigRequest, parseSessionArchiveConfig, parseSessionNamingConfig, piWebConfigRecord } from "./piWebConfigParsing.js";
import { createTranslator, userFacingErrorMessage } from "./i18n.js";

describe("central session override config parsing", () => {
  it.each([
    { sessionNaming: {} },
    { sessionArchive: {} },
    { sessionArchive: { directory: " relative archive " } },
    { sessionNaming: { model: "provider/org/model", maxTokens: Number.MAX_SAFE_INTEGER, thinkingLevel: "max", timeoutMs: 2147483647 }, sessionArchive: { directory: "../archive" } },
  ])("keeps file, request and serialized overrides identical without defaults: %j", (config) => {
    expect(parsePiWebConfig(config, "settings.json")).toEqual(config);
    expect(parsePiWebConfigRequest(config)).toEqual(config);
    expect(piWebConfigRecord(parsePiWebConfigRequest(config))).toEqual(config);
  });

  it.each([
    { sessionNaming: { model: "provider/model with spaces" } },
    { sessionNaming: { maxTokens: NaN } },
    { sessionNaming: { maxTokens: Infinity } },
    { sessionNaming: { timeoutMs: Infinity } },
    { sessionNaming: { thinkingLevel: "future-level" } },
    { sessionNaming: { unknown: true } },
    { sessionArchive: { directory: "  " } },
    { sessionArchive: { directory: "a\u0000b" } },
    { sessionArchive: { unknown: true } },
  ])("rejects invalid overrides equally at file and request boundaries: %j", (config) => {
    expect(() => parsePiWebConfig(config, "settings.json")).toThrow("PI WEB config session");
    expect(() => parsePiWebConfigRequest(config)).toThrow("PI WEB config session");
  });

  it("exports the same pure validators for API response consumers", () => {
    expect(parseSessionNamingConfig({ model: "provider/model", thinkingLevel: "off" }, "API response")).toEqual({ model: "provider/model", thinkingLevel: "off" });
    expect(parseSessionArchiveConfig({ directory: "archives" }, "API response")).toEqual({ directory: "archives" });
    expect(() => parseSessionNamingConfig({ timeoutMs: 0 }, "API response")).toThrow("API response");
    expect(() => parseSessionArchiveConfig({ unknown: true }, "API response")).toThrow('unknown key "unknown": API response');
  });

  it("localizes validation without translating source labels", () => {
    const translate = createTranslator("test", { "configError.sessionNaming.timeoutMs": "Local timeout validation: {source}" });
    let caught: unknown;
    try { parseSessionNamingConfig({ timeoutMs: 0 }, "raw source/path"); }
    catch (error) { caught = error; }
    expect(userFacingErrorMessage(caught, translate)).toBe("Local timeout validation: raw source/path");
  });
});
