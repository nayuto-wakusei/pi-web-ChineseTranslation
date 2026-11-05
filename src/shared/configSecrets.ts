import type {
  PiWebConfigResponse,
  PiWebConfigValues,
  PiWebSpeechApiKeyPresence,
} from "./apiTypes.js";

/** True when a layer supplies a non-empty directly stored speech key. */
function speechApiKeyPresent(config: PiWebConfigValues | undefined): boolean {
  const key = config?.speech?.apiKey;
  return typeof key === "string" && key.trim() !== "";
}

/** Presence metadata for a response whose values still contain the secret. */
function speechApiKeyPresence(
  config: PiWebConfigValues,
  effectiveConfig: PiWebConfigValues,
  defaultsConfig?: PiWebConfigValues,
): PiWebSpeechApiKeyPresence | undefined {
  const presence = {
    config: speechApiKeyPresent(config),
    effectiveConfig: speechApiKeyPresent(effectiveConfig),
    defaultsConfig: speechApiKeyPresent(defaultsConfig),
  };
  return presence.config || presence.effectiveConfig || presence.defaultsConfig ? presence : undefined;
}

/** Remove direct speech keys before a config value crosses a display or transport boundary. */
function redactPiWebConfigSecrets(config: PiWebConfigValues): PiWebConfigValues {
  if (config.speech?.apiKey === undefined) return config;
  const speech = { ...config.speech };
  Reflect.deleteProperty(speech, "apiKey");
  return { ...config, speech };
}

/**
 * Redact every config layer and describe what was removed. An existing presence
 * field wins so an already-redacted peer response keeps its metadata.
 */
export function redactPiWebConfigResponse(response: PiWebConfigResponse): PiWebConfigResponse {
  const presence = response.speechApiKeyPresence
    ?? speechApiKeyPresence(response.config, response.effectiveConfig, response.defaultsConfig);
  return {
    ...response,
    config: redactPiWebConfigSecrets(response.config),
    effectiveConfig: redactPiWebConfigSecrets(response.effectiveConfig),
    ...(response.defaultsConfig === undefined ? {} : { defaultsConfig: redactPiWebConfigSecrets(response.defaultsConfig) }),
    ...(presence === undefined ? {} : { speechApiKeyPresence: presence }),
  };
}

/**
 * A replacement omits the direct key when it was never sent to the caller.
 * Only an explicit PATCH unset removes the saved key.
 */
export function preserveStoredSpeechApiKey(current: PiWebConfigValues, replacement: PiWebConfigValues): PiWebConfigValues {
  const key = current.speech?.apiKey;
  if (key === undefined || replacement.speech?.apiKey !== undefined) return replacement;
  return { ...replacement, speech: { ...replacement.speech, apiKey: key } };
}
