import { afterEach, describe, expect, it } from "vitest";
import { localization } from "../localization/browser";
import { formatCost, formatFileSize, formatTokenCount } from "./format";

afterEach(async () => { await localization.setPreferences({ language: "en", formatLocale: "en" }); });

it("formats token counts with native compact notation and regional digits", async () => {
  for (const formatLocale of ["en", "de-DE", "ar-EG"]) {
    await localization.setPreferences({ language: "en", formatLocale });
    for (const count of [0, 512, 1234, 12000, 1500000, 12000000, Number.NaN, Infinity]) {
      const maximumFractionDigits = count >= 1000 && count < 10_000 || count >= 1_000_000 && count < 10_000_000 ? 1 : 0;
      expect(formatTokenCount(count)).toBe(new Intl.NumberFormat(formatLocale, { notation: "compact", maximumFractionDigits }).format(Number.isFinite(count) ? count : 0));
    }
  }
});

it("formats explicit USD costs without inferring currency from regional preferences", async () => {
  for (const formatLocale of ["en", "de-DE", "ar-EG"]) {
    await localization.setPreferences({ language: "en", formatLocale });
    for (const cost of [0, 0.001234, 12.34, Number.NaN, Infinity]) {
      const value = Number.isFinite(cost) ? cost : 0;
      const digits = value === 0 ? 0 : value < 0.01 ? 4 : 2;
      expect(formatCost(cost)).toBe(new Intl.NumberFormat(formatLocale, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value));
    }
  }
});

describe("formatFileSize", () => {
  it("keeps small sizes in whole bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("scales to binary units with one decimal below ten and whole numbers above", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1024 * 12)).toBe("12 KB");
    expect(formatFileSize(1024 * 1024 * 3.5)).toBe("3.5 MB");
    expect(formatFileSize(1024 * 1024 * 1024 * 2)).toBe("2.0 GB");
  });

  it("falls back to zero for unusable sizes", () => {
    expect(formatFileSize(-1)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});
