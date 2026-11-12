import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionFactory } from "../../piSdk.js";
import { loadNodeTranslator } from "../../localization.js";
import { UserFacingError } from "../../shared/i18n.js";
import { isRecord } from "../../shared/piWebConfigParsing.js";
import type { ManagementEmbedContext } from "../managementEmbed.js";
import { auditIdentifier, GuardrailOutbox, type GuardrailAction, type GuardrailEvent, type GuardrailStage } from "./guardrailAudit.js";

export interface GuardrailScope {
  managementContext: ManagementEmbedContext;
  cwd: string;
  sessionId?: string;
  turnId?: string;
  projectId?: string;
  managedFilePaths?: boolean;
  scopedDelegation?: boolean;
}

interface RuleModule {
  checkInput(text: string): Promise<string | null>;
  checkTool(request: Record<string, unknown>): Promise<string | null>;
  createGuardExtension(host: {checkTool(name: string, args: Record<string, unknown>): Promise<string | null>}): ExtensionFactory;
}

const policyVersion = "pi-embed-v1";
let env = process.env;
let outbox: GuardrailOutbox | undefined;
const shadowJobs = new Set<Promise<void>>();
const safeCode = /^[a-z][a-z0-9_.:-]{0,63}$/iu;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

export function managementGuardrailsEnabled(): boolean {
  return /^(?:true|1)$/iu.test(env["PI_GUARDRAIL_ENABLED"] ?? "");
}

/** sessiond captures private credentials before removing them from child process environments. */
export function startManagementGuardrails(environment: NodeJS.ProcessEnv): () => Promise<void> {
  env = environment;
  if (managementGuardrailsEnabled()) {
    try { outbox = new GuardrailOutbox(env); }
    catch { process.emitWarning("Guardrail audit storage unavailable; protected operations will retry on use"); }
  }
  return async () => {
    await Promise.allSettled([...shadowJobs]);
    outbox?.close();
    outbox = undefined;
    env = process.env;
  };
}

function isRuleModule(value: unknown): value is RuleModule {
  return isRecord(value) && value["POLICY_VERSION"] === policyVersion && typeof value["checkInput"] === "function"
    && typeof value["checkTool"] === "function" && typeof value["createGuardExtension"] === "function";
}

async function rules(): Promise<RuleModule> {
  const modulePath = env["PI_GUARDRAIL_MODULE"];
  if (modulePath === undefined || !isAbsolute(modulePath)) throw new Error("Missing guardrail module");
  const mod: unknown = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  if (!isRuleModule(mod)) throw new Error("Invalid guardrail module");
  return mod;
}

function explainReason(reason: string): string {
  const t = loadNodeTranslator("server");
  switch (reason) {
    case "instruction_override": case "classifier_control_token": case "unsafe_user_input":
      return t("guardrail.reason.injection", "The request attempts to bypass safety policy or contains unsafe instructions");
    case "credential_disclosure": case "protected_path":
      return t("guardrail.reason.protected", "The operation accesses protected data or credentials");
    case "destructive_operation": case "dangerous_operation": case "shell_not_permitted": case "opaque_operation":
      return t("guardrail.reason.operation", "The requested command or operation is outside the permitted set");
    case "detector_review_required":
      return t("guardrail.reason.review", "The detector could not confirm safety. Please clarify the request");
    case "material_requires_text":
      return t("guardrail.reason.material", "Supply a text version of this material for inspection");
    case "detector_unavailable": case "rules_unavailable": case "audit_storage_unavailable": case "invalid_mode":
      return t("guardrail.reason.unavailable", "The required safety check could not be completed");
    default:
      return t("guardrail.reason.scope", "The request exceeds the authorized scope or cannot be verified");
  }
}

export class ManagementGuardrailError extends UserFacingError {
  readonly statusCode: number;
  constructor(readonly reasonCode: string, readonly eventId: string, readonly status: number) {
    super(status === 503 ? "guardrail.unavailable" : "guardrail.blocked",
      status === 503 ? "Safety check unavailable. Retry this operation. Guardrail event {eventId} ({reason})." : "Blocked by safety policy. Guardrail event {eventId} ({reason}).",
      { eventId, reason: explainReason(reasonCode) });
    this.statusCode = status;
    this.message = loadNodeTranslator("server")(this.messageKey, this.fallback, this.parameters);
  }
}

function record(scope: GuardrailScope, stage: GuardrailStage, action: GuardrailAction, reasonCode: string,
  eventId: string = randomUUID(), extra: Pick<GuardrailEvent, "detectorVersion" | "latencyMs"> = {}): string {
  const projectId = auditIdentifier(scope.projectId, env);
  const sessionId = auditIdentifier(scope.sessionId, env);
  const turnId = auditIdentifier(scope.turnId, env);
  try {
    outbox ??= new GuardrailOutbox(env);
    outbox.append({ eventId, occurredAt: new Date().toISOString(), source: "pi_management_embed", stage,
      action, policyVersion, reasonCode, ...(projectId !== undefined && {projectId}), ...(sessionId !== undefined && {sessionId}), ...(turnId !== undefined && {turnId}), ...extra });
  } catch {
    // No business action may be retried as a side effect of an audit failure.
    process.emitWarning("Could not persist guardrail audit data");
    throw new ManagementGuardrailError("audit_storage_unavailable", eventId, 503);
  }
  return eventId;
}

export function managementGuardrailFailure(scope: GuardrailScope, stage: GuardrailStage, reason: string, status = 503): ManagementGuardrailError {
  try {
    return new ManagementGuardrailError(reason, record(scope, stage, status === 503 ? "error" : "block", reason), status);
  } catch (error) {
    if (error instanceof ManagementGuardrailError) return error;
    throw error;
  }
}

async function hard(scope: GuardrailScope, stage: GuardrailStage, check: (mod: RuleModule) => Promise<string | null>): Promise<void> {
  let reason;
  try {
    reason = await check(await rules());
    if (reason !== null && (typeof reason !== "string" || !safeCode.test(reason))) throw new Error("Invalid rule decision");
  } catch {
    throw managementGuardrailFailure(scope, stage, "rules_unavailable");
  }
  if (reason !== null) throw managementGuardrailFailure(scope, stage, reason, 403);
}

type TextStage = "user_input" | "external_text";
interface Decision { action: string; reasonCode: string; policyVersion: string; detectorVersion: string; decisionId: string }
class ReviewRequired extends Error {}

async function decision(stage: TextStage, text: string): Promise<Decision> {
  const url = env["PI_GUARDRAIL_ENDPOINT"];
  const token = env["PI_GUARDRAIL_TOKEN"];
  if (url === undefined || url === "" || token === undefined || token === "") throw new Error("Detector endpoint unavailable");
  const timeout = Number(env["PI_GUARDRAIL_TIMEOUT_MS"] ?? 5000);
  const response = await fetch(url, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(Number.isInteger(timeout) && timeout > 0 && timeout <= 120_000 ? timeout : 5000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({stage, text}) });
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 503 && isRecord(value) && value["reasonCode"] === "detector_review_required") throw new ReviewRequired();
    throw new Error("Detector unavailable");
  }
  if (!isRecord(value)) throw new Error("Invalid detector decision");
  const { action, reasonCode, detectorVersion, decisionId } = value;
  if (typeof action !== "string" || (action !== "allow" && action !== (stage === "user_input" ? "block" : "isolate")) ||
    typeof reasonCode !== "string" || !safeCode.test(reasonCode) || typeof detectorVersion !== "string" ||
    !/^[a-z0-9][a-z0-9_.:-]{0,63}$/iu.test(detectorVersion) || value["policyVersion"] !== policyVersion ||
    typeof decisionId !== "string" || !uuid.test(decisionId)) throw new Error("Invalid detector decision");
  return { action, reasonCode, detectorVersion, decisionId, policyVersion };
}

async function inspect(scope: GuardrailScope, stage: TextStage, text: string): Promise<string | undefined> {
  const mode = env[stage === "user_input" ? "PI_GUARDRAIL_INPUT_MODE" : "PI_GUARDRAIL_MATERIAL_MODE"] ?? "shadow";
  if (mode !== "shadow" && mode !== "enforce") throw new ManagementGuardrailError("invalid_mode", record(scope, stage, "error", "invalid_mode"), 503);
  if (mode === "enforce") return evaluateText(scope, stage, text, mode);
  // Shadow checks never delay queueing or streaming. Bound in-memory request bodies when the detector is busy.
  if (shadowJobs.size >= 8) {
    record(scope, stage, "error", "shadow_capacity");
    return;
  }
  const job = evaluateText(scope, stage, text, mode).then(() => undefined, () => {
    process.emitWarning("A shadow guardrail result could not be recorded");
  });
  shadowJobs.add(job);
  void job.finally(() => { shadowJobs.delete(job); });
  return;
}

async function evaluateText(scope: GuardrailScope, stage: TextStage, text: string, mode: "shadow" | "enforce"): Promise<string | undefined> {
  const start = Date.now();
  let d;
  try { d = await decision(stage, text); } catch (error) {
    const reason = error instanceof ReviewRequired ? "detector_review_required" : "detector_unavailable";
    const status = error instanceof ReviewRequired ? 403 : 503;
    const id = record(scope, stage, status === 403 ? mode === "shadow" ? "shadow_hit" : "block" : "error", reason);
    if (mode === "enforce") throw new ManagementGuardrailError(reason, id, status);
    return;
  }
  const hit = d.action !== "allow";
  const action = !hit ? "allow" : mode === "shadow" ? "shadow_hit" : stage === "external_text" ? "isolate" : "block";
  record(scope, stage, action, d.reasonCode, d.decisionId, { detectorVersion: d.detectorVersion, latencyMs: Date.now() - start });
  if (hit && mode === "enforce") {
    if (stage === "user_input") throw new ManagementGuardrailError(d.reasonCode, d.decisionId, 403);
    return loadNodeTranslator("server")("guardrail.isolated", "External material isolated by safety policy. Guardrail event {eventId}.", { eventId: d.decisionId });
  }
  return;
}

export async function checkManagementInput(scope: GuardrailScope, text: string): Promise<void> {
  if (!managementGuardrailsEnabled()) return;
  await hard(scope, "user_input", mod => mod.checkInput(text));
  await inspect(scope, "user_input", text);
}

export async function checkManagementMaterial(scope: GuardrailScope, text: string): Promise<{text: string; isolated: boolean}> {
  if (!managementGuardrailsEnabled() || !text) return { text, isolated: false };
  const replacement = await inspect(scope, "external_text", text);
  return { text: replacement ?? text, isolated: replacement !== undefined };
}

export function checkManagementUninspectableMaterial(scope: GuardrailScope): Promise<void> {
  if (managementGuardrailsEnabled()) {
    const mode = env["PI_GUARDRAIL_MATERIAL_MODE"] ?? "shadow";
    const eventId = record(scope, "external_text", mode === "shadow" ? "error" : "block", "material_requires_text");
    if (mode !== "shadow") return Promise.reject(new ManagementGuardrailError("material_requires_text", eventId, 403));
  }
  return Promise.resolve();
}

export async function checkManagementTool(scope: GuardrailScope, tool: string, args: Record<string, unknown>, allowedCapabilities?: string[]): Promise<void> {
  if (!managementGuardrailsEnabled()) return;
  const projects = scope.managementContext.projects;
  const allowedProjects = projects.length ? projects.map(p => p.id) : ["default-project"];
  await hard(scope, "before_tool", mod => mod.checkTool({ tool, args, cwd: scope.cwd, projectId: scope.projectId,
    allowedProjects, allowedCapabilities, managedFilePaths: scope.managedFilePaths, scopedDelegation: scope.scopedDelegation }));
  record(scope, "before_tool", "allow", "tool_allowed");
}

export function createManagementGuardExtension(scope: GuardrailScope): ExtensionFactory {
  return async pi => {
    if (!managementGuardrailsEnabled()) return;
    let factory;
    try {
      factory = (await rules()).createGuardExtension({ async checkTool(name, args) {
        try { await checkManagementTool(scope, name, args); return null; }
        catch (error) { if (error instanceof ManagementGuardrailError) return error.message; throw error; }
      } });
      await factory(pi);
    } catch {
      // The SDK can continue loading after an extension initialization error.
      pi.on("tool_call", () => ({ block: true, reason: managementGuardrailFailure(scope, "before_tool", "rules_unavailable").message }));
    }
  };
}
