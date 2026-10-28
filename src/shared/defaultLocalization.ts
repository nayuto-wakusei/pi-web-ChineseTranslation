export type LocalizationHourCycle = "h11" | "h12" | "h23" | "h24";

/** Gateway defaults; omitted fields inherit browser/runtime preferences. */
export interface PiWebDefaultLocalization {
  language?: string;
  formatLocale?: string;
  timeZone?: string;
  hourCycle?: LocalizationHourCycle;
}

const allowedKeys = new Set(["language", "formatLocale", "timeZone", "hourCycle"]);

/** Validate and canonicalize persisted defaults without resolving browser preferences. */
export function requireDefaultLocalization(value: unknown, source = "request"): PiWebDefaultLocalization {
  const fail = (detail: string): never => {
    throw new Error(`PI WEB config defaultLocalization ${detail}: ${source}`);
  };
  if (!isRecord(value)) return fail("must be an object");
  const record = value;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) fail(`contains unknown key ${key}`);
  }
  const result: PiWebDefaultLocalization = {};
  for (const key of ["language", "formatLocale"] as const) {
    const locale = record[key];
    if (locale === undefined) continue;
    if (typeof locale !== "string" || locale === "") return fail(`${key} must be a valid locale`);
    let canonical: string;
    try {
      const parsed = Intl.getCanonicalLocales(locale)[0];
      if (parsed === undefined) return fail(`${key} must be a valid locale`);
      canonical = parsed;
    } catch {
      return fail(`${key} must be a valid locale`);
    }
    const { language, region } = new Intl.Locale(canonical);
    if ((language === "en" && region === "XA") || (language === "ar" && region === "XB")) {
      return fail(`${key} pseudo locales are development-only`);
    }
    result[key] = canonical;
  }
  const timeZone = record["timeZone"];
  if (timeZone !== undefined) {
    if (typeof timeZone !== "string" || timeZone === "") return fail("timeZone must be a valid date/time zone");
    try {
      result.timeZone = new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone;
    } catch {
      return fail("timeZone must be a valid date/time zone");
    }
  }
  const hourCycle = record["hourCycle"];
  if (hourCycle !== undefined) {
    if (hourCycle !== "h11" && hourCycle !== "h12" && hourCycle !== "h23" && hourCycle !== "h24") {
      return fail("hourCycle must be h11, h12, h23, or h24");
    }
    result.hourCycle = hourCycle;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
