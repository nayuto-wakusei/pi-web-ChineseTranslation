import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep, isAbsolute } from "node:path";
import type { Project } from "./types.js";
import type { PiWebManagementEmbedConfig } from "../shared/apiTypes.js";
import { isRecord } from "../shared/piWebConfigParsing.js";
import { createFixedTtlSessionStore, readCookie, type HttpSession } from "./httpSessions.js";

export const MANAGEMENT_EMBED_MODE_HEADER = "x-pi-web-embed-mode";
export const MANAGEMENT_EMBED_TOKEN_HEADER = "x-pi-web-embed-token";
export const MANAGEMENT_EMBED_CONTEXT_HEADER = "x-pi-web-management-context";
export const WORKBENCH_ACCESS_HANDLE_HEADER = "x-pi-web-workbench-access-handle";
const MANAGEMENT_FORCE_DENY_TOOLS = new Set(["bash", "shell", "terminal"]);
const DEFAULT_MANAGED_PROJECT_ID = "default-project";
const DEFAULT_MANAGEMENT_SHARED_SECRET_ENV = "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN";
const DEFAULT_MANAGEMENT_TOKEN_ISSUER = "telecom-portal";
const DEFAULT_MANAGEMENT_TOKEN_AUDIENCE = "dify-external-portal";
const MANAGEMENT_SESSION_COOKIE = "pi_web_management_session";
const MANAGEMENT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ManagementEmbedContext {
  user: {
    id: string;
    rootUserId: string;
    displayName?: string;
    roles: string[];
    permissions: string[];
  };
  projects: { id: string; name: string; role?: string; root?: string; agentsInstructions?: string }[];
  tools?: { allow?: string[]; deny?: string[]; permissions?: Record<string, boolean> };
  sandbox?: { pythonExecutable?: string; env?: Record<string, string> };
  expiresAt?: string;
}

export interface ManagementEmbedRuntime {
  enabled: boolean;
  projectRoot: string;
  authenticate(token: string): Promise<ManagementEmbedContext>;
  prepareContext?(context: ManagementEmbedContext): Promise<void>;
  createSession?(context: ManagementEmbedContext): ManagementEmbedSession;
  readSession?(id: string): ManagementEmbedContext | undefined;
  sessionCookieName?: string;
  resourceHandle?(context: ManagementEmbedContext): string | undefined;
}

const workbenchHandles = new WeakMap<ManagementEmbedContext, string>();

export function attachWorkbenchAccessHandle(context: ManagementEmbedContext, handle: string | undefined): ManagementEmbedContext {
  if (handle !== undefined && handle !== "") workbenchHandles.set(context, handle);
  return context;
}

export function workbenchAccessHandle(context: ManagementEmbedContext): string | undefined {
  return workbenchHandles.get(context);
}

export interface ManagementEmbedRuntimeOptions {
  now?: () => Date;
  randomSessionId?: () => string;
}

export type ManagementEmbedSession = HttpSession;

export interface ManagementEmbedRequest {
  mode?: "management";
  token?: string;
}

export interface ManagementEmbedRequestSource {
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
  protocol?: string;
}

export interface ManagementEmbedReplyTarget {
  header(name: string, value: string): unknown;
}

export interface ManagedProjectPathOptions {
  create?: boolean;
}

export function readManagementEmbedRequest(headers: Record<string, string | string[] | undefined>, query?: Record<string, unknown>): ManagementEmbedRequest {
  const modeHeader = firstHeader(headers[MANAGEMENT_EMBED_MODE_HEADER]);
  const tokenHeader = firstHeader(headers[MANAGEMENT_EMBED_TOKEN_HEADER]);
  const embedQuery = typeof query?.["embed"] === "string" ? query["embed"].trim() : undefined;
  const tokenQuery = typeof query?.["token"] === "string" ? query["token"].trim() : undefined;
  const isManagement = modeHeader === "management" || embedQuery === "management" || tokenHeader !== undefined;
  const token = isManagement ? tokenHeader ?? tokenQuery : undefined;
  return {
    ...(isManagement ? { mode: "management" as const } : {}),
    ...(token === undefined ? {} : { token }),
  };
}

export async function managementContextForRequest(request: ManagementEmbedRequestSource, runtime: ManagementEmbedRuntime | undefined, reply?: ManagementEmbedReplyTarget): Promise<ManagementEmbedContext | undefined> {
  const embed = readManagementEmbedRequest(request.headers, isRecord(request.query) ? request.query : undefined);
  if (embed.mode !== "management") return undefined;
  const sessionId = readCookie(request.headers["cookie"], runtime?.sessionCookieName ?? MANAGEMENT_SESSION_COOKIE);
  if (runtime?.enabled !== true) throw new Error("Management embed mode is not configured");
  const sessionContext = sessionId === undefined || runtime.readSession === undefined ? undefined : runtime.readSession(sessionId);
  if (embed.token === undefined || embed.token === "") {
    if (sessionContext !== undefined) return prepareManagementContext(runtime, sessionContext);
    if (sessionId !== undefined) throw new Error("Management embed session is invalid or expired");
    throw new Error("Management embed token is required");
  }

  let context: ManagementEmbedContext;
  try {
    context = await runtime.authenticate(embed.token);
  } catch (error) {
    if (sessionContext !== undefined && isExpiredManagementTokenError(error)) return prepareManagementContext(runtime, sessionContext);
    throw error;
  }
  await runtime.prepareContext?.(context);
  if (reply !== undefined && runtime.createSession !== undefined) {
    const session = runtime.createSession(context);
    writeSessionCookie(reply, runtime.sessionCookieName ?? MANAGEMENT_SESSION_COOKIE, session, isSecureRequest(request));
  }
  return context;
}

async function prepareManagementContext(runtime: ManagementEmbedRuntime, context: ManagementEmbedContext): Promise<ManagementEmbedContext> {
  await runtime.prepareContext?.(context);
  return context;
}

export function createManagementEmbedRuntime(
  config: PiWebManagementEmbedConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
  options: ManagementEmbedRuntimeOptions = {},
): ManagementEmbedRuntime | undefined {
  if (config?.enabled !== true) return undefined;
  const configuredSecretEnv = config.auth?.sharedSecretEnv?.trim();
  const sharedSecretEnv = configuredSecretEnv !== undefined && configuredSecretEnv !== "" ? configuredSecretEnv : DEFAULT_MANAGEMENT_SHARED_SECRET_ENV;
  const sharedSecret = env[sharedSecretEnv]?.trim();
  const configuredIssuer = config.auth?.issuer?.trim();
  const configuredAudience = config.auth?.audience?.trim();
  const issuer = configuredIssuer !== undefined && configuredIssuer !== "" ? configuredIssuer : DEFAULT_MANAGEMENT_TOKEN_ISSUER;
  const audience = configuredAudience !== undefined && configuredAudience !== "" ? configuredAudience : DEFAULT_MANAGEMENT_TOKEN_AUDIENCE;
  const now = options.now ?? (() => new Date());
  const randomSessionId = options.randomSessionId ?? (() => randomBytes(32).toString("base64url"));
  const sessionStore = createFixedTtlSessionStore<ManagementEmbedContext>(MANAGEMENT_SESSION_TTL_MS, () => now().getTime(), randomSessionId);
  if (sharedSecret === undefined || sharedSecret === "") {
    return {
      enabled: true,
      projectRoot: config.projectRoot ?? defaultManagedProjectRoot(homeDir),
      authenticate: () => Promise.reject(new Error("Management embed auth is not configured")),
      createSession: sessionStore.create,
      readSession: sessionStore.read,
      sessionCookieName: MANAGEMENT_SESSION_COOKIE,
    };
  }
  return {
    enabled: true,
    projectRoot: config.projectRoot ?? defaultManagedProjectRoot(homeDir),
    authenticate: (token) => Promise.resolve(verifyManagementEntryToken(token, {
      secret: sharedSecret,
      issuer,
      audience,
      now,
    })),
    createSession: sessionStore.create,
    readSession: sessionStore.read,
    sessionCookieName: MANAGEMENT_SESSION_COOKIE,
  };
}

export function managementProjectRoot(runtime: ManagementEmbedRuntime | undefined): string {
  if (runtime === undefined) throw new Error("Management embed mode is not configured");
  return runtime.projectRoot;
}

export async function managedProjectPath(projectRoot: string, rootUserId: string, projectId: string, options: ManagedProjectPathOptions = {}): Promise<string> {
  const root = await ensureRealDirectory(projectRoot);
  const requested = join(root, safePathSegment(rootUserId), safePathSegment(projectId));
  ensureInside(root, requested);
  const target = await projectPathTarget(requested, options.create !== false);
  ensureInside(root, target);
  return target;
}

export async function projectFromManagedEmbedContext(projectRoot: string, context: ManagementEmbedContext, projectId: string, options: ManagedProjectPathOptions = {}): Promise<Project> {
  const entry = authorizedManagedProjects(context).find((project) => project.id === projectId);
  if (entry === undefined) throw new Error("Project is not authorized for this management session");
  const path = context.projects.length === 0 && entry.id === DEFAULT_MANAGED_PROJECT_ID
    ? await defaultManagedProjectPath(projectRoot, context.user.id, options)
    : await pathForManagedProjectEntry(projectRoot, context, entry, options);
  if (options.create !== false) await ensureManagedProjectAgentsFile(path, entry.agentsInstructions);
  return { id: entry.id, name: entry.name !== "" ? entry.name : entry.id, path, createdAt: new Date(0).toISOString() };
}

export async function projectsFromManagedEmbedContext(projectRoot: string, context: ManagementEmbedContext): Promise<Project[]> {
  return Promise.all(authorizedManagedProjects(context).map((project) => projectFromManagedEmbedContext(projectRoot, context, project.id, { create: false })));
}

export async function managementProjectIdForCwd(projectRoot: string, context: ManagementEmbedContext, cwd: string): Promise<string> {
  const requested = await realpath(resolve(cwd));
  const projects = await projectsFromManagedEmbedContext(projectRoot, context);
  const project = projects.find((candidate) => pathsEqual(candidate.path, requested) || isInside(candidate.path, requested));
  if (project === undefined) throw new Error("Managed workspace does not match an authorized project");
  return project.id;
}

export async function assertManagedCwd(projectRoot: string, context: ManagementEmbedContext, cwd: string, options: ManagedProjectPathOptions = {}): Promise<string> {
  const root = await ensureRealDirectory(projectRoot);
  const create = options.create !== false;
  const authorizedRoots = context.projects.length === 0
    ? [await defaultManagedProjectPath(root, context.user.id, { create })]
    : await Promise.all(context.projects.map(async (project) => {
      const projectRootOverride = project.root?.trim();
      if (projectRootOverride !== undefined && projectRootOverride !== "") return realpath(resolve(projectRootOverride));
      return managedProjectPath(root, context.user.rootUserId, project.id, { create });
    }));
  const resolvedCwd = resolve(cwd);
  if (create && authorizedRoots.some((authorized) => pathsEqual(authorized, resolvedCwd))) await mkdir(resolvedCwd, { recursive: true });
  const requested = await realpath(resolvedCwd);
  ensureInside(root, requested);
  if (!authorizedRoots.some((authorized) => isInside(authorized, requested))) {
    throw new Error("Path is outside the managed project sandbox");
  }
  return requested;
}

export function managementToolAllowed(context: ManagementEmbedContext, tool: string): boolean {
  if (tool === "terminal-command-runs") return toolAllowedByAllowList(context, tool);
  if (MANAGEMENT_FORCE_DENY_TOOLS.has(tool)) return false;
  const deny = new Set(context.tools?.deny ?? []);
  if (deny.has(tool)) return false;
  return toolAllowedByAllowList(context, tool);
}

function toolAllowedByAllowList(context: ManagementEmbedContext, tool: string): boolean {
  const allow = context.tools?.allow;
  return allow === undefined || allow.length === 0 || allow.includes(tool);
}

export function encodeManagementContext(context: ManagementEmbedContext): string {
  return Buffer.from(JSON.stringify(context), "utf8").toString("base64url");
}

export function decodeManagementContext(value: string | undefined): ManagementEmbedContext | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid management embed context");
  return parseIntrospectionPayload({ active: true, ...parsed });
}

function verifyManagementEntryToken(
  token: string,
  options: { secret: string; issuer: string; audience: string; now: () => Date },
): ManagementEmbedContext {
  const [encodedPayload, signature, extra] = token.split(".");
  if (encodedPayload === undefined || encodedPayload === "" || signature === undefined || signature === "" || extra !== undefined) {
    throw new Error("Management embed token is invalid");
  }
  const expectedSignature = createHmac("sha256", options.secret).update(encodedPayload).digest("base64url");
  if (!safeEqualBase64Url(signature, expectedSignature)) throw new Error("Management embed token is invalid");

  const parsed = parseJsonBase64Url(encodedPayload);
  if (!isRecord(parsed)) throw new Error("Management embed token is invalid");
  if (stringField(parsed, "iss") !== options.issuer || stringField(parsed, "aud") !== options.audience) {
    throw new Error("Management embed token is invalid");
  }
  const nowSeconds = Math.floor(options.now().getTime() / 1000);
  const iat = numberField(parsed, "iat");
  const exp = numberField(parsed, "exp");
  if (iat > nowSeconds + 60) throw new Error("Management embed token is invalid");
  if (exp <= nowSeconds) throw new Error("Management embed token is expired");
  stringField(parsed, "jti");
  return parseIntrospectionPayload({ active: true, ...parsed, expiresAt: new Date(exp * 1000).toISOString() });
}

function writeSessionCookie(reply: ManagementEmbedReplyTarget, name: string, session: ManagementEmbedSession, secure: boolean): void {
  const crossSiteAttributes = secure ? "Secure; SameSite=None" : "SameSite=Lax";
  reply.header("set-cookie", `${name}=${session.id}; Path=/; HttpOnly; ${crossSiteAttributes}; Max-Age=${String(session.maxAgeSeconds)}`);
}

function isSecureRequest(request: ManagementEmbedRequestSource): boolean {
  if (request.protocol === "https") return true;
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"])?.split(",", 1)[0]?.trim();
  return forwardedProto === "https";
}

function parseJsonBase64Url(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Management embed token is invalid");
  }
}

function safeEqualBase64Url(left: string, right: string): boolean {
  try {
    const leftBuffer = Buffer.from(left, "base64url");
    const rightBuffer = Buffer.from(right, "base64url");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function parseIntrospectionPayload(payload: Record<string, unknown>): ManagementEmbedContext {
  const user = payload["user"];
  const projects = payload["projects"];
  if (!isRecord(user) || !Array.isArray(projects)) throw new Error("Management embed introspection response is invalid");
  const displayName = optionalStringField(user, "displayName");
  const context: ManagementEmbedContext = {
    user: {
      id: stringField(user, "id"),
      rootUserId: stringField(user, "rootUserId"),
      ...(displayName === undefined ? {} : { displayName }),
      roles: stringArray(user["roles"]),
      permissions: stringArray(user["permissions"]),
    },
    projects: projects.map(parseProjectEntry),
  };
  if (isRecord(payload["tools"])) context.tools = parseTools(payload["tools"]);
  if (isRecord(payload["sandbox"])) context.sandbox = parseSandbox(payload["sandbox"]);
  if (typeof payload["expiresAt"] === "string") context.expiresAt = payload["expiresAt"];
  return context;
}

function parseTools(value: Record<string, unknown>): NonNullable<ManagementEmbedContext["tools"]> {
  return {
    ...(Array.isArray(value["allow"]) ? { allow: stringArray(value["allow"]) } : {}),
    ...(Array.isArray(value["deny"]) ? { deny: stringArray(value["deny"]) } : {}),
    ...(isRecord(value["permissions"]) ? { permissions: booleanRecord(value["permissions"]) } : {}),
  };
}

function parseSandbox(value: Record<string, unknown>): NonNullable<ManagementEmbedContext["sandbox"]> {
  return {
    ...(typeof value["pythonExecutable"] === "string" ? { pythonExecutable: value["pythonExecutable"] } : {}),
    ...(isRecord(value["env"]) ? { env: stringRecord(value["env"]) } : {}),
  };
}

function parseProjectEntry(value: unknown): ManagementEmbedContext["projects"][number] {
  if (!isRecord(value)) throw new Error("Management embed project entry is invalid");
  const agentsInstructions = optionalContentField(value, "agentsInstructions");
  return {
    id: stringField(value, "id"),
    name: stringField(value, "name"),
    ...(typeof value["role"] === "string" ? { role: value["role"] } : {}),
    ...(typeof value["root"] === "string" ? { root: value["root"] } : {}),
    ...(agentsInstructions === undefined ? {} : { agentsInstructions }),
  };
}

async function ensureManagedProjectAgentsFile(projectPath: string, instructions: string | undefined): Promise<void> {
  if (instructions === undefined || instructions.trim() === "") return;
  try {
    await writeFile(join(projectPath, "AGENTS.md"), instructions, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isNodeErrorWithCode(error, "EEXIST")) return;
    throw error;
  }
}

async function ensureRealDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}

async function pathForManagedProjectEntry(
  projectRoot: string,
  context: ManagementEmbedContext,
  project: ManagementEmbedContext["projects"][number],
  options: ManagedProjectPathOptions,
): Promise<string> {
  const entryRoot = project.root?.trim();
  if (entryRoot !== undefined && entryRoot !== "") return assertManagedCwd(projectRoot, context, entryRoot);
  return managedProjectPath(projectRoot, context.user.rootUserId, project.id, options);
}

function isExpiredManagementTokenError(error: unknown): boolean {
  return error instanceof Error && error.message === "Management embed token is expired";
}

function authorizedManagedProjects(context: ManagementEmbedContext): ManagementEmbedContext["projects"] {
  return context.projects.length === 0 ? [defaultManagedProject(context)] : context.projects;
}

function defaultManagedProject(context: ManagementEmbedContext): ManagementEmbedContext["projects"][number] {
  return {
    id: DEFAULT_MANAGED_PROJECT_ID,
    name: `${context.user.id}的项目`,
  };
}

async function defaultManagedProjectPath(projectRoot: string, userId: string, options: ManagedProjectPathOptions = {}): Promise<string> {
  const root = await ensureRealDirectory(projectRoot);
  const requested = join(root, safePathSegment(userId));
  ensureInside(root, requested);
  const target = await projectPathTarget(requested, options.create !== false);
  ensureInside(root, target);
  return target;
}

async function projectPathTarget(requested: string, create: boolean): Promise<string> {
  if (create) await mkdir(requested, { recursive: true });
  try {
    return await realpath(requested);
  } catch (error) {
    if (!create && (isNodeErrorWithCode(error, "ENOENT") || isNodeErrorWithCode(error, "ENOTDIR"))) return requested;
    throw error;
  }
}

function defaultManagedProjectRoot(homeDir: string): string {
  return join(homeDir, "PiWeb");
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim();
  return normalized === "" ? undefined : normalized;
}

function safePathSegment(value: string): string {
  const segment = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return segment === "" ? "unknown" : segment;
}

function ensureInside(root: string, target: string): void {
  if (!isInside(root, target)) throw new Error("Path is outside the managed project sandbox");
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === "") return true;
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return sep === "/" || !rel.split(sep).includes("..");
}

function pathsEqual(left: string, right: string): boolean {
  return relative(left, right) === "";
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") throw new Error(`Management embed ${key} is required`);
  return field.trim();
}

function optionalStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() !== "" ? field.trim() : undefined;
}

function optionalContentField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() !== "" ? field : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isInteger(field)) throw new Error("Management embed token is invalid");
  return field;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function booleanRecord(value: Record<string, unknown>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
