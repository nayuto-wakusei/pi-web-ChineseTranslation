import { html, nothing, type TemplateResult } from "lit";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { localization } from "../../localization/browser";
import source from "./settingsConfigUpdate.messages";
import { isPiWebConfigNamespacePath, piWebConfigSettingPointers } from "../../../../shared/configResolution";

const messages = localization.registerMessages("core.settingsConfigUpdate", source);
export interface SettingsConfigUpdate { set?: PiWebConfigValues; unset?: string[] }
export type ResetSettings = (paths: string[]) => void | Promise<void>;

export function settingPath(...segments: string[]): string {
  return `/${segments.map((segment) => segment.replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/")}`;
}

export function settingValue(config: PiWebConfigValues | undefined, path: string): unknown {
  let value: unknown = config;
  for (const segment of path.slice(1).split("/")) {
    if (value === null || typeof value !== "object") return undefined;
    value = Object.getOwnPropertyDescriptor(value, segment.replace(/~1/gu, "/").replace(/~0/gu, "~"))?.value;
  }
  return value;
}

/** Legacy flags remain useful when connected to an older machine. */
export function enforcedSetting(response: PiWebConfigResponse | undefined, path: string): string | undefined {
  for (let ancestor = path; ancestor !== ""; ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"))) {
    const enforced = response?.enforcedSettings?.[ancestor];
    if (enforced !== undefined) return enforced;
  }
  const key = path.slice(1).split("/")[0] ?? "";
  if (response && Object.getOwnPropertyDescriptor(response.envOverrides, key)?.value === true) {
    return `PI_WEB_${key.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}`;
  }
  return undefined;
}

/** Compare only supplied settings; objects replace, except approved namespaces. */
export function explicitConfigUpdate(response: PiWebConfigResponse | undefined, candidate: PiWebConfigValues, baseline = response?.config ?? {}): SettingsConfigUpdate {
  const set: Record<string, unknown> = {};
  const visit = (value: unknown, previous: unknown, segments: string[], target: Record<string, unknown>): void => {
    const key = segments[segments.length - 1];
    if (key === undefined) return;
    const path = settingPath(...segments);
    if (enforcedSetting(response, path) !== undefined) return;
    const namespace = isPiWebConfigNamespacePath(segments);
    if (namespace && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const children: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) visit(child, previous !== null && typeof previous === "object" ? Object.getOwnPropertyDescriptor(previous, key)?.value : undefined, [...segments, key], children);
      if (Object.keys(children).length) Object.defineProperty(target, key, { value: children, enumerable: true });
    } else if (value !== undefined && JSON.stringify(value) !== JSON.stringify(previous)) {
      Object.defineProperty(target, key, { value, enumerable: true });
    }
  };
  for (const [key, value] of Object.entries(candidate)) visit(value, Object.getOwnPropertyDescriptor(baseline, key)?.value, [key], set);
  return Object.keys(set).length ? { set } : {};
}

export function resetConfigUpdate(response: PiWebConfigResponse | undefined, paths: string[]): SettingsConfigUpdate {
  const saved = piWebConfigSettingPointers(response?.config ?? {});
  return { unset: [...new Set(paths.flatMap((path) => saved.filter((leaf) => leaf === path || leaf.startsWith(`${path}/`))))]
    .filter((path) => enforcedSetting(response, path) === undefined) };
}

/** Selected-machine responses omit gateway-only settings; absence clears owned overrides. */
export function mergeSelectedSettingsResponse(base: PiWebConfigResponse, incoming: PiWebConfigResponse, keys: (keyof PiWebConfigValues)[]): PiWebConfigResponse {
  const values = (previous: PiWebConfigValues, next: PiWebConfigValues): PiWebConfigValues => {
    const result = { ...previous };
    for (const key of keys) Reflect.deleteProperty(result, key);
    return { ...result, ...Object.fromEntries(Object.entries(next).filter(([key]) => keys.some((ownedKey) => ownedKey === key))) };
  };
  const sources = (previous: Record<string, string> = {}, next: Record<string, string> = {}): Record<string, string> => ({
    ...Object.fromEntries(Object.entries(previous).filter(([path]) => !keys.some((key) => path === `/${key}` || path.startsWith(`/${key}/`)))),
    ...Object.fromEntries(Object.entries(next).filter(([path]) => keys.some((key) => path === `/${key}` || path.startsWith(`/${key}/`)))),
  });
  return { ...base, config: values(base.config, incoming.config), effectiveConfig: values(base.effectiveConfig, incoming.effectiveConfig),
    ...(base.defaultsConfig === undefined && incoming.defaultsConfig === undefined ? {} : { defaultsConfig: values(base.defaultsConfig ?? {}, incoming.defaultsConfig ?? {}) }),
    ...(base.enforcedSettings === undefined && incoming.enforcedSettings === undefined ? {} : { enforcedSettings: sources(base.enforcedSettings, incoming.enforcedSettings) }),
    ...(base.configSources === undefined && incoming.configSources === undefined ? {} : { configSources: sources(base.configSources, incoming.configSources) }),
    envOverrides: { ...base.envOverrides, ...incoming.envOverrides },
  };
}

export function settingSource(variable: string | undefined, sourceName: string | undefined): TemplateResult | typeof nothing {
  return variable !== undefined ? html`<small>${messages.t("enforced", { variable })}</small>` : sourceName !== undefined ? html`<small>${messages.t("source", { source: sourceName })}</small>` : nothing;
}

/** A source label and deletion-based reset, shared by all core Settings surfaces. */
export function settingControls(response: PiWebConfigResponse | undefined, path: string, busy: boolean, onReset?: ResetSettings): TemplateResult | typeof nothing {
  const variable = enforcedSetting(response, path);
  let sourceName: string | undefined;
  for (let ancestor = path; ancestor !== "" && sourceName === undefined; ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"))) sourceName = response?.configSources?.[ancestor];
  const resetPaths = resetConfigUpdate(response, [path]).unset ?? [];
  if (variable === undefined && sourceName === undefined && (!onReset || settingValue(response?.config, path) === undefined)) return nothing;
  return html`<span class="setting-controls">
    ${settingSource(variable, sourceName)}
    ${onReset && settingValue(response?.config, path) !== undefined ? html`<button type="button" class="ui-button ui-button--action ui-button--compact" aria-label=${messages.t("resetSetting", { setting: path })} ?disabled=${busy || resetPaths.length === 0} @click=${() => { void onReset(resetPaths); }}>${messages.t("reset")}</button>` : nothing}
  </span>`;
}
