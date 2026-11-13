import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionFactory } from "../../piSdk.js";
import { loadNodeTranslator } from "../../localization.js";
import { UserFacingError } from "../../shared/i18n.js";
import { isRecord } from "../../shared/piWebConfigParsing.js";
import { authorizedManagedProjects, type ManagementEmbedContext } from "../managementEmbed.js";
import { GuardrailOutbox, type GuardrailAction, type GuardrailEvent, type GuardrailStage } from "./guardrailAudit.js";

export interface GuardrailScope {
  managementContext: ManagementEmbedContext;
  cwd: string;
  sessionId?: string;
  turnId?: string;
  projectId?: string;
  managedFilePaths?: boolean;
  scopedDelegation?: boolean;
  origin?: string;
  task?: string;
  tool?: string;
  traceId?: string;
  toolCallId?: string;
  materialRef?: string;
}

interface AuditCapture {
  text?: string;
  args?: Record<string, unknown>;
  start?: number;
  end?: number;
  layer?: string;
  mode?: "enforce" | "shadow";
  labels?: string[];
  window?: number;
}
interface RuleModule {
  auditReference?: (value: string | undefined, kind?: "id" | "code") => string | undefined;
  redact?: (
    text: string,
    options?: { limit?: number; start?: number; end?: number },
  ) => { text: string; originalLength: number; truncated: boolean };
  inputLocation?(text: string, reason: string): { start: number; end: number } | undefined;
  toolContext?(
    tool: string,
    args: Record<string, unknown>,
  ): { operation?: string; targetCategory?: string; destinationCategory?: string };
  toolSummary?(tool: string, args: Record<string, unknown>): string;
  checkInput(text: string): Promise<string | null>;
  checkTool(request: Record<string, unknown>): Promise<string | null>;
  createGuardExtension(host: {
    checkTool(name: string, args: Record<string, unknown>, callId?: string): Promise<string | null>;
  }): ExtensionFactory;
}

const policyVersion = "pi-embed-v1";
const turn = new AsyncLocalStorage<GuardrailScope>();
let auditRules: RuleModule | undefined;

export function withGuardrailTurn<T>(scope: GuardrailScope, task: string, submit: () => T): T {
  const current = turn.getStore();
  const turnId =
    scope.turnId ??
    (current?.sessionId === scope.sessionId && current?.task === task ? current.turnId : undefined) ??
    randomUUID();
  return turn.run({ ...scope, task, turnId }, submit);
}

function snapshot(scope: GuardrailScope): GuardrailScope {
  const current = turn.getStore();
  const associated =
    current !== undefined &&
    current.sessionId === scope.sessionId &&
    current.managementContext.user.id === scope.managementContext.user.id;
  const { user, projects } = scope.managementContext;
  return {
    ...(associated ? current : {}),
    ...scope,
    managementContext: {
      ...scope.managementContext,
      user: { ...user, roles: [...user.roles] },
      projects: projects.map((project) => ({ ...project })),
    },
  };
}

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
    try {
      outbox = new GuardrailOutbox(env);
    } catch {
      process.emitWarning("Guardrail audit storage unavailable; protected operations will retry on use");
    }
  }
  return async () => {
    await Promise.allSettled([...shadowJobs]);
    outbox?.close();
    outbox = undefined;
    auditRules = undefined;
    env = process.env;
  };
}

function isRuleModule(value: unknown): value is RuleModule {
  return (
    isRecord(value) &&
    value["POLICY_VERSION"] === policyVersion &&
    typeof value["checkInput"] === "function" &&
    typeof value["checkTool"] === "function" &&
    typeof value["createGuardExtension"] === "function"
  );
}

async function rules(): Promise<RuleModule> {
  const modulePath = env["PI_GUARDRAIL_MODULE"];
  if (modulePath === undefined || !isAbsolute(modulePath)) throw new Error("Missing guardrail module");
  const mod: unknown = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  if (!isRuleModule(mod)) throw new Error("Invalid guardrail module");
  auditRules = mod;
  return mod;
}

function explainReason(reason: string): string {
  const t = loadNodeTranslator("server");
  switch (reason) {
    case "instruction_override":
    case "classifier_control_token":
    case "unsafe_user_input":
      return t(
        "guardrail.reason.injection",
        "The request attempts to bypass safety policy or contains unsafe instructions",
      );
    case "credential_disclosure":
    case "protected_path":
      return t("guardrail.reason.protected", "The operation accesses protected data or credentials");
    case "destructive_operation":
    case "dangerous_operation":
    case "shell_not_permitted":
    case "opaque_operation":
      return t("guardrail.reason.operation", "The requested command or operation is outside the permitted set");
    case "detector_review_required":
      return t("guardrail.reason.review", "The detector could not confirm safety. Please clarify the request");
    case "material_requires_text":
      return t("guardrail.reason.material", "Supply a text version of this material for inspection");
    case "detector_timeout":
    case "detector_unavailable":
    case "rules_unavailable":
    case "audit_storage_unavailable":
    case "invalid_mode":
      return t("guardrail.reason.unavailable", "The required safety check could not be completed");
    default:
      return t("guardrail.reason.scope", "The request exceeds the authorized scope or cannot be verified");
  }
}

export class ManagementGuardrailError extends UserFacingError {
  readonly statusCode: number;
  constructor(
    readonly reasonCode: string,
    readonly eventId: string,
    readonly status: number,
  ) {
    super(
      status === 503 ? "guardrail.unavailable" : "guardrail.blocked",
      status === 503
        ? "Safety check unavailable. Retry this operation. Guardrail event {eventId} ({reason})."
        : "Blocked by safety policy. Guardrail event {eventId} ({reason}).",
      { eventId, reason: explainReason(reasonCode) },
    );
    this.statusCode = status;
    this.message = loadNodeTranslator("server")(this.messageKey, this.fallback, this.parameters);
  }
}

function record(
  scope: GuardrailScope,
  stage: GuardrailStage,
  action: GuardrailAction,
  reasonCode: string,
  eventId: string = randomUUID(),
  extra: Pick<GuardrailEvent, "detectorVersion" | "latencyMs"> = {},
  capture: AuditCapture = {},
): string {
  const { user } = scope.managementContext;
  const projects = authorizedManagedProjects(scope.managementContext);
  const project =
    scope.projectId !== undefined
      ? projects.find((item) => item.id === scope.projectId)
      : projects.length === 1
        ? projects[0]
        : undefined;
  const event: GuardrailEvent = {
    schemaVersion: 2,
    eventId,
    occurredAt: new Date().toISOString(),
    source: "pi_management_embed",
    stage,
    action,
    ...(project && { projectId: project.id }),
  };
  try {
    if (action !== "allow") {
      const mode = capture.mode ?? "enforce";
      const review = reasonCode === "detector_review_required";
      const text =
        capture.args !== undefined && scope.tool !== undefined
          ? auditRules?.toolSummary?.(scope.tool, capture.args)
          : capture.text;
      const mask = auditRules?.redact;
      const reference = auditRules?.auditReference;

      const task = mask?.(scope.task ?? "", { limit: 1200 });
      const materialRef = mask?.(scope.materialRef ?? "", { limit: 128 }).text;
      const budget = 8000 - Array.from(task?.text ?? "").length - Array.from(materialRef ?? "").length;
      const contextSize =
        capture.end !== undefined && capture.start !== undefined ? capture.end - capture.start + 400 : budget;
      const excerpt = mask?.(text ?? "", {
        limit: Math.min(budget, contextSize),
        ...(capture.start !== undefined && { start: capture.start }),
        ...(capture.end !== undefined && { end: capture.end }),
      });
      const toolContext =
        scope.tool !== undefined && capture.args !== undefined
          ? auditRules?.toolContext?.(scope.tool, capture.args)
          : undefined;
      Object.assign(event, {
        operation: toolContext?.operation,
        targetCategory: toolContext?.targetCategory,
        destinationCategory: toolContext?.destinationCategory,
        policyVersion,
        reasonCode,
        ...extra,
        actorId: user.id,
        actorName: user.displayName === undefined ? undefined : mask?.(user.displayName, { limit: 128 }).text,
        actorRoles: user.roles,
        projectName: project === undefined ? undefined : mask?.(project.name, { limit: 128 }).text,
        sessionId: reference?.(scope.sessionId),
        turnId: reference?.(scope.turnId),
        traceId: reference?.(scope.traceId),
        toolCallId: reference?.(scope.toolCallId),
        origin: scope.origin ?? (stage === "before_tool" ? "tool_call" : stage),
        tool: reference?.(scope.tool,"code"),
        materialRef: scope.materialRef === undefined ? undefined : materialRef,
        task: task?.text,
        evidence: excerpt?.text,
        originalLength: capture.args === undefined ? excerpt?.originalLength :
          typeof capture.args["command"] === "string" ? Array.from(capture.args["command"]).length : undefined,
        truncated: excerpt?.truncated === true || task?.truncated === true,
        layer: capture.layer ?? "host",
        mode,
        ruleId: capture.layer === "hard_rules" && action !== "error" ? reasonCode : undefined,
        action: review ? "review" : action,
        verdict: review ? "review" : action === "error" ? "error" : "risk",
        disposition:
          mode === "shadow"
            ? action === "error"
              ? "unavailable"
              : "shadow_allowed"
            : review || action === "error"
              ? "paused"
              : action === "isolate"
                ? "isolated"
                : "blocked",
        execution: stage === "before_tool" && mode === "enforce" ? "not_dispatched" : "unknown",
        labels: capture.labels,
        window: capture.window,
        matchStart: capture.start,
        matchEnd: capture.end,
      });
    }
    outbox ??= new GuardrailOutbox(env);
    outbox.append(event);
  } catch {
    // No business action may be retried as a side effect of an audit failure.
    process.emitWarning("Could not persist guardrail audit data");
    throw new ManagementGuardrailError("audit_storage_unavailable", eventId, 503);
  }
  return eventId;
}

export function managementGuardrailFailure(
  scope: GuardrailScope,
  stage: GuardrailStage,
  reason: string,
  status = 503,
  capture: AuditCapture = {},
  elapsed?: number,
): ManagementGuardrailError {
  try {
    return new ManagementGuardrailError(
      reason,
      record(
        scope,
        stage,
        status === 503 ? "error" : "block",
        reason,
        undefined,
        elapsed !== undefined ? { latencyMs: elapsed } : {},
        capture,
      ),
      status,
    );
  } catch (error) {
    if (error instanceof ManagementGuardrailError) return error;
    throw error;
  }
}

async function hard(
  scope: GuardrailScope,
  stage: GuardrailStage,
  check: (mod: RuleModule) => Promise<string | null>,
  capture: AuditCapture,
): Promise<void> {
  const start = Date.now();
  let reason;
  try {
    reason = await check(await rules());
    if (reason !== null && (typeof reason !== "string" || !safeCode.test(reason)))
      throw new Error("Invalid rule decision");
  } catch {
    throw managementGuardrailFailure(scope, stage, "rules_unavailable", 503, capture, Date.now() - start);
  }
  if (reason !== null) {
    const location = capture.text === undefined ? undefined : auditRules?.inputLocation?.(capture.text, reason);
    throw managementGuardrailFailure(scope, stage, reason, 403, { ...capture, ...location }, Date.now() - start);
  }
}

type TextStage = "user_input" | "external_text";
interface Decision extends AuditCapture {
  action: string;
  reasonCode: string;
  policyVersion: string;
  detectorVersion: string;
  decisionId: string;
}
class DetectorError extends Error {
  constructor(
    readonly reason: string,
    readonly version: string | undefined,
    readonly diagnostics: AuditCapture,
  ) {
    super(reason);
  }
}

function diagnostics(value: Record<string, unknown>, text: string): AuditCapture {
  const result: AuditCapture = {};
  const { start, end, window, labels } = value;
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= Array.from(text).length
  ) {
    result.start = start;
    result.end = end;
  }
  if (typeof window === "number" && Number.isInteger(window) && window >= 1 && window <= 128) result.window = window;
  const known = [
    "Violent",
    "Non-violent Illegal Acts",
    "Sexual Content or Sexual Acts",
    "PII",
    "Suicide & Self-Harm",
    "Unethical Acts",
    "Politically Sensitive Topics",
    "Copyright Violation",
    "Jailbreak",
  ];
  if (Array.isArray(labels))
    result.labels = labels
      .filter((item): item is string => typeof item === "string" && known.includes(item))
      .slice(0, 12);
  return result;
}

async function decision(stage: TextStage, text: string): Promise<Decision> {
  const url = env["PI_GUARDRAIL_ENDPOINT"];
  const token = env["PI_GUARDRAIL_TOKEN"];
  if (url === undefined || url === "" || token === undefined || token === "")
    throw new Error("Detector endpoint unavailable");
  const timeout = Number(env["PI_GUARDRAIL_TIMEOUT_MS"] ?? 5000);
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(Number.isInteger(timeout) && timeout > 0 && timeout <= 120_000 ? timeout : 5000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ stage, text }),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 503 && isRecord(value)) {
      const reason = value["reasonCode"];
      const version = value["detectorVersion"];
      throw new DetectorError(
        typeof reason === "string" &&
        [
          "detector_review_required",
          "detector_busy",
          "detector_timeout",
          "detector_invalid_result",
          "detector_invalid_template",
          "detector_version_mismatch",
          "detector_incomplete",
          "detector_window_budget",
        ].includes(reason)
          ? reason
          : "detector_unavailable",
        typeof version === "string" && safeCode.test(version) ? version : undefined,
        diagnostics(value, text),
      );
    }
    throw new Error("Detector unavailable");
  }
  if (!isRecord(value)) throw new Error("Invalid detector decision");
  const { action, reasonCode, detectorVersion, decisionId } = value;
  if (
    typeof action !== "string" ||
    (action !== "allow" && action !== (stage === "user_input" ? "block" : "isolate")) ||
    typeof reasonCode !== "string" ||
    !safeCode.test(reasonCode) ||
    typeof detectorVersion !== "string" ||
    !/^[a-z0-9][a-z0-9_.:-]{0,63}$/iu.test(detectorVersion) ||
    value["policyVersion"] !== policyVersion ||
    typeof decisionId !== "string" ||
    !uuid.test(decisionId)
  )
    throw new Error("Invalid detector decision");
  return { action, reasonCode, detectorVersion, decisionId, policyVersion, ...diagnostics(value, text) };
}

async function inspect(scope: GuardrailScope, stage: TextStage, text: string): Promise<string | undefined> {
  const mode = env[stage === "user_input" ? "PI_GUARDRAIL_INPUT_MODE" : "PI_GUARDRAIL_MATERIAL_MODE"] ?? "shadow";
  scope = snapshot(scope);
  if (mode !== "shadow" && mode !== "enforce")
    throw new ManagementGuardrailError("invalid_mode", record(scope, stage, "error", "invalid_mode"), 503);
  if (mode === "enforce") return evaluateText(scope, stage, text, mode);
  // Shadow checks never delay queueing or streaming. Bound in-memory request bodies when the detector is busy.
  if (shadowJobs.size >= 8) {
    record(
      scope,
      stage,
      "error",
      "shadow_capacity",
      undefined,
      {},
      { mode, text, layer: stage === "user_input" ? "qwen" : "horizon" },
    );
    return;
  }
  const job = evaluateText(scope, stage, text, mode).then(
    () => undefined,
    () => {
      process.emitWarning("A shadow guardrail result could not be recorded");
    },
  );
  shadowJobs.add(job);
  void job.finally(() => {
    shadowJobs.delete(job);
  });
  return;
}

async function evaluateText(
  scope: GuardrailScope,
  stage: TextStage,
  text: string,
  mode: "shadow" | "enforce",
): Promise<string | undefined> {
  const start = Date.now();
  const capture = { text, mode, layer: stage === "user_input" ? "qwen" : "horizon" };
  let d;
  try {
    d = await decision(stage, text);
  } catch (error) {
    const reason =
      error instanceof DetectorError
        ? error.reason
        : error instanceof Error && error.name === "TimeoutError"
          ? "detector_timeout"
          : "detector_unavailable";
    const status = reason === "detector_review_required" ? 403 : 503;
    const id = record(
      scope,
      stage,
      status === 403 ? (mode === "shadow" ? "shadow_hit" : "block") : "error",
      reason,
      undefined,
      {
        latencyMs: Date.now() - start,
        ...(error instanceof DetectorError && error.version !== undefined && { detectorVersion: error.version }),
      },
      { ...capture, ...(error instanceof DetectorError ? error.diagnostics : {}) },
    );
    if (mode === "enforce") throw new ManagementGuardrailError(reason, id, status);
    return;
  }
  const hit = d.action !== "allow";
  const action = !hit ? "allow" : mode === "shadow" ? "shadow_hit" : stage === "external_text" ? "isolate" : "block";
  record(
    scope,
    stage,
    action,
    d.reasonCode,
    d.decisionId,
    { detectorVersion: d.detectorVersion, latencyMs: Date.now() - start },
    { ...d, ...capture },
  );
  if (hit && mode === "enforce") {
    if (stage === "user_input") throw new ManagementGuardrailError(d.reasonCode, d.decisionId, 403);
    return loadNodeTranslator("server")(
      "guardrail.isolated",
      "External material isolated by safety policy. Guardrail event {eventId}.",
      { eventId: d.decisionId },
    );
  }
  return;
}

export async function checkManagementInput(scope: GuardrailScope, text: string): Promise<void> {
  if (!managementGuardrailsEnabled()) return;
  scope = snapshot(scope);
  await hard(scope, "user_input", (mod) => mod.checkInput(text), { text, layer: "hard_rules" });
  await inspect(scope, "user_input", text);
}

export async function checkManagementMaterial(
  scope: GuardrailScope,
  text: string,
): Promise<{ text: string; isolated: boolean }> {
  if (!managementGuardrailsEnabled() || !text) return { text, isolated: false };
  scope = snapshot(scope);
  if (!auditRules) await rules().catch(() => undefined);
  const replacement = await inspect(scope, "external_text", text);
  return { text: replacement ?? text, isolated: replacement !== undefined };
}

export function checkManagementUninspectableMaterial(scope: GuardrailScope): Promise<void> {
  if (managementGuardrailsEnabled()) {
    scope = snapshot(scope);
    const mode = env["PI_GUARDRAIL_MATERIAL_MODE"] ?? "shadow";
    const eventId = record(
      scope,
      "external_text",
      mode === "shadow" ? "error" : "block",
      "material_requires_text",
      undefined,
      {},
      { mode: mode === "shadow" ? "shadow" : "enforce" },
    );
    if (mode !== "shadow") return Promise.reject(new ManagementGuardrailError("material_requires_text", eventId, 403));
  }
  return Promise.resolve();
}

export async function checkManagementTool(
  scope: GuardrailScope,
  tool: string,
  args: Record<string, unknown>,
  allowedCapabilities?: string[],
): Promise<void> {
  if (!managementGuardrailsEnabled()) return;
  scope = { ...snapshot(scope), tool };
  const projects = scope.managementContext.projects;
  const allowedProjects = projects.length ? projects.map((p) => p.id) : ["default-project"];
  await hard(
    scope,
    "before_tool",
    (mod) =>
      mod.checkTool({
        tool,
        args,
        cwd: scope.cwd,
        projectId: scope.projectId,
        allowedProjects,
        allowedCapabilities,
        managedFilePaths: scope.managedFilePaths,
        scopedDelegation: scope.scopedDelegation,
      }),
    { args, layer: "hard_rules" },
  );
  record(scope, "before_tool", "allow", "tool_allowed");
}

export function createManagementGuardExtension(scope: GuardrailScope): ExtensionFactory {
  return async (pi) => {
    if (!managementGuardrailsEnabled()) return;
    let factory;
    try {
      factory = (await rules()).createGuardExtension({
        async checkTool(name, args, callId) {
          try {
            await checkManagementTool({ ...scope, ...(callId !== undefined && { toolCallId: callId }) }, name, args);
            return null;
          } catch (error) {
            if (error instanceof ManagementGuardrailError) return error.message;
            throw error;
          }
        },
      });
      await factory(pi);
    } catch {
      // The SDK can continue loading after an extension initialization error.
      pi.on("tool_call", () => ({
        block: true,
        reason: managementGuardrailFailure(scope, "before_tool", "rules_unavailable").message,
      }));
    }
  };
}
