import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { PiWebConfigResponse } from "../../../shared/apiTypes.js";
import { LOCALIZATION_FIELDS, LocalizationService, normalizePreferences, normalizePreferenceOverrides, type LocalizationPolicy, type LocalizationPreferences } from "./service.js";

const STORAGE_KEY = "pi-web-localization";
export const localization = new LocalizationService({ development: import.meta.env.DEV });
const configuredByService = new WeakMap<LocalizationService, Partial<LocalizationPreferences>>();
const browserDefaultsByService = new WeakMap<LocalizationService, LocalizationPreferences>();
type GatewayPreferenceConfig = Pick<PiWebConfigResponse, "effectiveConfig" | "enforcedSettings" | "configSources">;

export function localizationPolicyFromConfig(response: GatewayPreferenceConfig): LocalizationPolicy {
  const enforcedFields: NonNullable<LocalizationPolicy["enforcedFields"]> = {};
  const sources: NonNullable<LocalizationPolicy["sources"]> = {};
  for (const field of LOCALIZATION_FIELDS) {
    const pointer = `/defaultLocalization/${field}`;
    const enforcedBy = response.enforcedSettings?.[pointer];
    const source = response.configSources?.[pointer];
    if (enforcedBy !== undefined) enforcedFields[field] = enforcedBy;
    if (source !== undefined) sources[field] = source;
  }
  return { enforcedFields, sources };
}

/** Refresh gateway defaults and policy atomically; browser overrides remain untouched. */
export function configureLocalizationPolicy(response: GatewayPreferenceConfig, service = localization): Promise<void> {
  return configureLocalizationDefaults(response.effectiveConfig.defaultLocalization ?? {}, localizationPolicyFromConfig(response), service);
}

function configureLocalizationDefaults(configured: Partial<LocalizationPreferences>, policy: LocalizationPolicy, service: LocalizationService): Promise<void> {
  const normalized = normalizePreferenceOverrides(configured);
  const defaults = browserDefaultsByService.get(service) ?? browserLocalizationPreferences();
  const ready = service.setPreferenceDefaults(normalizePreferences({ ...defaults, ...normalized }), policy);
  configuredByService.set(service, normalized);
  return ready;
}

/** Snapshot browser defaults without inferring a time zone or currency from a locale. */
export function browserLocalizationPreferences(navigator: Pick<Navigator, "languages" | "language"> | undefined = typeof window === "undefined" ? undefined : window.navigator): LocalizationPreferences {
  const locale = navigator?.languages[0] ?? navigator?.language ?? "en";
  return { language: locale, formatLocale: locale };
}

/** Describes inheritance, independently of any explicit browser-local override. */
export function inheritedLocalizationSetting(field: "formatLocale" | "timeZone", service = localization): { source: "server" | "browser"; value: string } {
  const configured = configuredByService.get(service);
  const value = service.preferenceDefaults[field] ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { source: configured?.[field] === undefined ? "browser" : "server", value };
}

/** Explicit startup boundary; importing localization never reads browser globals or attaches listeners. */
export async function initializeLocalization(
  service = localization,
  environment: Pick<Window, "localStorage" | "navigator" | "document"> & { location: Pick<Location, "search"> } = window,
  development = import.meta.env.DEV,
  configuredDefaults: Partial<LocalizationPreferences> | Promise<Partial<LocalizationPreferences> | undefined> = {},
  configuredPolicy: LocalizationPolicy | Promise<LocalizationPolicy> = {},
): Promise<() => void> {
  const defaults = browserLocalizationPreferences(environment.navigator);
  let inherited = defaults;
  let overrides: Partial<LocalizationPreferences> = {};
  try {
    const stored = environment.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) overrides = normalizePreferenceOverrides(JSON.parse(stored));
  } catch (cause) {
    console.warn("[i18n] Could not restore localization preferences; using browser defaults", cause);
  }
  const pseudo = development ? new URLSearchParams(environment.location.search).get("pseudoLocale") : null;
  const pseudoLanguage = pseudo === "en-XA" || pseudo === "ar-XB" ? pseudo : undefined;
  let savedLanguage = overrides.language;
  if (overrides.language === "en-XA" || overrides.language === "ar-XB") {
    delete overrides.language;
    savedLanguage = undefined;
  }
  if (pseudoLanguage !== undefined) overrides = { ...overrides, language: pseudoLanguage };
  configuredByService.set(service, {});
  browserDefaultsByService.set(service, defaults);
  // Clear previous initialization state before applying browser/config defaults.
  void service.setPreferenceDefaults(defaults, {});
  void service.setPreferenceOverrides({});
  void service.setPreferenceOverrides(overrides);
  // Install persistence before translations settle; only their display loads asynchronously.
  await Promise.resolve();
  let previousRevision = service.preferenceRevision;
  const update = (): void => {
    environment.document.documentElement.lang = service.language;
    environment.document.documentElement.dir = service.direction;
    const revision = service.preferenceRevision;
    if (revision === previousRevision) return;
    previousRevision = revision;
    const current = service.preferenceOverrides;
    const language = current.language === "en-XA" || current.language === "ar-XB" ? savedLanguage ?? inherited.language : current.language;
    const stored = { ...current, ...(language === undefined ? {} : { language }) };
    try {
      environment.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (cause) { console.warn("[i18n] Could not save localization preferences", cause); }
  };
  update();
  const unsubscribe = service.subscribe(update);
  try {
    const [configured, policy] = await Promise.all([configuredDefaults, configuredPolicy]);
    // Defaults can arrive after a user edit. Enforcement hides, but never replaces, that edit.
    void configureLocalizationDefaults(configured ?? {}, policy, service);
    inherited = service.preferenceDefaults;
  } catch (cause) {
    unsubscribe();
    throw cause;
  }
  return unsubscribe;
}

/** Add to every localized Lit host; disconnected hosts release their subscription. */
export class LocalizationController implements ReactiveController {
  private unsubscribe: (() => void) | undefined;
  constructor(
    private readonly host: ReactiveControllerHost,
    readonly service: Pick<LocalizationService, "subscribe"> = localization,
    private readonly invalidate?: () => void,
  ) {
    host.addController(this);
  }
  hostConnected(): void {
    this.unsubscribe ??= this.service.subscribe(() => { this.invalidate?.(); this.host.requestUpdate(); });
    // Guarded/cached surfaces also need invalidation after a disconnected locale change.
    this.invalidate?.();
    this.host.requestUpdate();
  }
  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
