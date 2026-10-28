import { afterEach } from "vitest";
import { LocalizationService } from "../../src/client/src/localization/service";
import { createPluginLocalization } from "../../src/client/src/plugins/localization";
import { createFilesContent } from "./filesLocalization";

const lifetimes: AbortController[] = [];
afterEach(() => { for (const lifetime of lifetimes.splice(0)) lifetime.abort(); });

export function filesLocalizationFixture(formatLocale = "en-US") {
  const service = new LocalizationService({ development: true, preferences: { language: "en", formatLocale }, diagnostic: () => undefined });
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const localization = createPluginLocalization(service, "files", "files", lifetime.signal);
  let content: ReturnType<typeof createFilesContent> | undefined;
  return { service, localization, get content() { return content ??= createFilesContent(localization); }, lifetime };
}
