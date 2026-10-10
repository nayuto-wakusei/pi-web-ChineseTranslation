import { ProjectTrustStore, SettingsManager, hasTrustRequiringProjectResources, type ProjectTrustContext, type ProjectTrustEvent, type ProjectTrustEventResult } from "@earendil-works/pi-coding-agent";

/**
 * Error collected from a `project_trust` handler, mirroring the per-extension
 * errors the SDK's `emitProjectTrustEvent` returns (its `extensionPath` and
 * `error` fields are what the reported message needs).
 */
export interface WebProjectTrustExtensionError {
  extensionPath: string;
  error: string;
}

/**
 * The slice of the SDK's `LoadExtensionsResult` the trust event emitter reads:
 * each pre-trust extension's path and its registered `project_trust` handlers.
 * Narrowing keeps this module free of the SDK's full `Extension` internals; a
 * real `LoadExtensionsResult` (as handed to the resource loader's
 * `resolveProjectTrust` callback) is structurally assignable to it.
 */
export interface WebProjectTrustExtensionSet {
  extensions: {
    path: string;
    handlers: Map<string, readonly ((event: ProjectTrustEvent, ctx: ProjectTrustContext) => unknown)[]>;
  }[];
}

/**
 * Inputs for {@link resolveWebProjectTrusted} — the web mirror of the inputs
 * the SDK's `resolveProjectTrusted` takes.
 */
export interface WebProjectTrustResolution {
  cwd: string;
  /**
   * The pre-trust extension set the SDK loaded for this resolution (user/global
   * extensions; project-local ones are not loaded yet because trust is still
   * unresolved). When present, those extensions may decide trust via the
   * `project_trust` event.
   */
  extensionsResult?: WebProjectTrustExtensionSet;
  /** The agent dir's trust store; `remember`-ed decisions are written here. */
  trustStore: ProjectTrustStore;
  /** Settings manager whose `defaultProjectTrust` applies when nothing decided. */
  settingsManager: SettingsManager;
  /**
   * Reports a `project_trust` handler error, mirroring the SDK's
   * `onExtensionError`.
   */
  onExtensionError?: (message: string) => void;
}

/**
 * Run the `project_trust` event over a pre-trust extension set, mirroring
 * `emitProjectTrustEvent` in the SDK's `dist/core/extensions/runner.js`. That
 * helper is not part of the package's public exports (the main index exports
 * only the `ProjectTrust*` types and `ProjectTrustStore`, and the package's
 * `exports` map blocks subpath imports, so `resolveProjectTrusted`/
 * `emitProjectTrustEvent` are not callable from here), so PI WEB reimplements
 * its documented decision loop over the SDK-provided extension objects: per
 * extension, the registered `project_trust` handlers run in order; the first
 * handler returning `yes`/`no` decides and `undecided` falls through to the
 * next handler/extension; a throwing handler is collected as an error and
 * later handlers still get their chance.
 */
export async function emitWebProjectTrustEvent(
  extensionsResult: WebProjectTrustExtensionSet,
  event: ProjectTrustEvent,
  ctx: ProjectTrustContext,
): Promise<{ result?: ProjectTrustEventResult; errors: WebProjectTrustExtensionError[] }> {
  const errors: WebProjectTrustExtensionError[] = [];
  for (const extension of extensionsResult.extensions) {
    // A single extension may register multiple handlers for the same event.
    // The handlers map is keyed exactly as the extension registered it, so a
    // `project_trust` key guarantees `ProjectTrustHandler` entries — the same
    // assumption the SDK's emitProjectTrustEvent makes.
    const handlers = extension.handlers.get("project_trust");
    if (handlers === undefined || handlers.length === 0) continue;
    for (const handler of handlers) {
      try {
        const handlerResult: unknown = await handler(event, ctx);
        // The SDK reads `trusted` straight off the handler result, so a
        // non-object would throw there; PI WEB reports it as a handler error
        // and lets the next handler/extension try.
        if (typeof handlerResult !== "object" || handlerResult === null) {
          errors.push({ extensionPath: extension.path, error: "project_trust handler returned a non-object result" });
          continue;
        }
        const trusted = "trusted" in handlerResult ? handlerResult.trusted : undefined;
        if (trusted === "undecided") {
          continue;
        }
        // Rebuild the decision so only the documented `trusted`/`remember`
        // fields carry over — the SDK's resolver reads exactly those two.
        const remember = "remember" in handlerResult ? handlerResult.remember : undefined;
        return {
          result: {
            trusted: trusted === "yes" ? "yes" : "no",
            ...(remember === true ? { remember: true } : {}),
          },
          errors,
        };
      } catch (error) {
        errors.push({
          extensionPath: extension.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { errors };
}

/**
 * PI WEB's headless project-trust context. `hasUI` is false because there is
 * no browser trust prompt (chartered behavior: `ask` never loads untrusted
 * resources), so the UI methods are inert — the same no-UI shape the SDK
 * passes when pi runs without a trust UI. The host mode is `rpc`, mirroring
 * how PI WEB binds its session extension contexts.
 */
function webProjectTrustContext(cwd: string): ProjectTrustContext {
  return {
    cwd,
    mode: "rpc",
    hasUI: false,
    ui: {
      select: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(false),
      input: () => Promise.resolve(undefined),
      notify: () => undefined,
    },
  };
}

/**
 * Resolve whether a workspace's project-local `.pi/` resources may load, the
 * way `pi` resolves it — a faithful mirror of the SDK's `resolveProjectTrusted`
 * (`dist/core/project-trust.js`, also not a public export). PI WEB has no
 * browser trust prompt, so the precedence is, in order:
 *
 * 1. Nothing trust-requiring under `cwd` → trusted.
 * 2. Pre-trust extensions (user/global — project-local ones are not loaded
 *    yet) may decide via the `project_trust` event; `remember: true` persists
 *    the decision to the agent dir's `trust.json`. Handler errors are reported
 *    through {@link WebProjectTrustResolution.onExtensionError} and never
 *    abort resolution.
 * 3. Otherwise the saved `trust.json` decision wins.
 * 4. Otherwise `defaultProjectTrust` decides (`always` trusts; `never`/`ask`
 *    do not — `ask` cannot prompt in the browser, matching `pi` run without a
 *    trust UI).
 */
export async function resolveWebProjectTrusted(resolution: WebProjectTrustResolution): Promise<boolean> {
  const { cwd, trustStore, settingsManager } = resolution;
  if (!hasTrustRequiringProjectResources(cwd)) return true;
  if (resolution.extensionsResult) {
    const { result, errors } = await emitWebProjectTrustEvent(
      resolution.extensionsResult,
      { type: "project_trust", cwd },
      webProjectTrustContext(cwd),
    );
    for (const error of errors) {
      resolution.onExtensionError?.(`Extension "${error.extensionPath}" project_trust error: ${error.error}`);
    }
    if (result) {
      const trusted = result.trusted === "yes";
      if (result.remember === true) {
        trustStore.set(cwd, trusted);
      }
      return trusted;
    }
  }
  const saved = trustStore.get(cwd);
  if (saved !== null) return saved;
  return settingsManager.getDefaultProjectTrust() === "always";
}
