import { describe, expect, it } from "vitest";
import { parsePiWebConfig, parsePiWebConfigRequest, parseSessionArchiveConfig, piWebConfigRecord } from "./piWebConfigParsing.js";
import { createTranslator, userFacingErrorMessage } from "./i18n.js";

describe("central session override config parsing", () => {
  it.each([
    { sessionArchive: {} },
    { sessionArchive: { directory: " relative archive " } },
    { sessionArchive: { directory: "../archive" } },
  ])("keeps file, request and serialized overrides identical without defaults: %j", (config) => {
    expect(parsePiWebConfig(config, "settings.json")).toEqual(config);
    expect(parsePiWebConfigRequest(config)).toEqual(config);
    expect(piWebConfigRecord(parsePiWebConfigRequest(config))).toEqual(config);
  });

  it.each([
    { sessionArchive: { directory: "  " } },
    { sessionArchive: { directory: "a\u0000b" } },
    { sessionArchive: { unknown: true } },
  ])("rejects invalid overrides equally at file and request boundaries: %j", (config) => {
    expect(() => parsePiWebConfig(config, "settings.json")).toThrow("PI WEB config session");
    expect(() => parsePiWebConfigRequest(config)).toThrow("PI WEB config session");
  });

  it("exports the same pure validators for API response consumers", () => {
    expect(parseSessionArchiveConfig({ directory: "archives" }, "API response")).toEqual({ directory: "archives" });
    expect(() => parseSessionArchiveConfig({ unknown: true }, "API response")).toThrow('unknown key "unknown": API response');
  });

  it("localizes validation without translating source labels", () => {
    const translate = createTranslator("test", { "configError.sessionArchive.directory": "Local directory validation: {source}" });
    let caught: unknown;
    try { parseSessionArchiveConfig({ directory: "" }, "raw source/path"); }
    catch (error) { caught = error; }
    expect(userFacingErrorMessage(caught, translate)).toBe("Local directory validation: raw source/path");
  });
});
