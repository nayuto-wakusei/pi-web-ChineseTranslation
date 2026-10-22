import type { PiWebConfigValues } from "./apiTypes.js";
import { UserFacingError } from "./i18n.js";

export function requireDefaultStreamingBehavior(value: unknown, source: string): NonNullable<PiWebConfigValues["defaultStreamingBehavior"]> {
  if (value !== "steer" && value !== "followUp") {
    throw new UserFacingError("configError.defaultStreamingBehavior.invalid", "PI WEB config defaultStreamingBehavior must be steer or followUp: {source}", { source });
  }
  return value;
}
