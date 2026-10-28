import { describe, expect, it } from "vitest";
import { requireDefaultLocalization } from "./defaultLocalization.js";

describe("default localization validation", () => {
  it("canonicalizes locales and native date/time zones", () => {
    expect(requireDefaultLocalization({ language: "EN-us", formatLocale: "de-de", timeZone: "america/new_york", hourCycle: "h23" })).toEqual({
      language: "en-US", formatLocale: "de-DE", timeZone: "America/New_York", hourCycle: "h23",
    });
  });

  it("allows empty resets and independent partial defaults", () => {
    expect(requireDefaultLocalization({})).toEqual({});
    expect(requireDefaultLocalization({ formatLocale: "fr" })).toEqual({ formatLocale: "fr" });
  });

  it.each(["h11", "h12", "h23", "h24"])("accepts hour cycle %s", (hourCycle) => {
    expect(requireDefaultLocalization({ hourCycle })).toEqual({ hourCycle });
  });

  it.each([
    null, [], "en", 42,
    { unknown: true }, { language: "en", typo: "de" },
    { language: "" }, { language: "en_US" }, { language: false },
    { formatLocale: "" }, { formatLocale: "not a locale" }, { formatLocale: null },
    { timeZone: "" }, { timeZone: "Mars/Olympus" }, { timeZone: 12 },
    { hourCycle: "h25" }, { hourCycle: null },
  ])("rejects invalid defaults %j", (value) => {
    expect(() => requireDefaultLocalization(value, "fixture")).toThrow("PI WEB config defaultLocalization");
  });

  it.each(["en-XA", "ar-XB", "EN-xa", "en-XA-u-nu-latn", "ar-Arab-XB"])("rejects development-only pseudo locale %s", (locale) => {
    for (const key of ["language", "formatLocale"]) {
      expect(() => requireDefaultLocalization({ [key]: locale })).toThrow("development-only");
    }
  });
});
