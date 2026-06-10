import { homedir } from "node:os";
import { mkdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep, isAbsolute } from "node:path";
import type { FastifyRequest } from "fastify";
import type { Project } from "./types.js";
import type { PiWebManagementEmbedConfig } from "../shared/apiTypes.js";

export const MANAGEMENT_EMBED_MODE_HEADER = "x-pi-web-embed-mode";
export const MANAGEMENT_EMBED_TOKEN_HEADER = "x-pi-web-embed-token";
export const MANAGEMENT_EMBED_CONTEXT_HEADER = "x-pi-web-management-context";
const MANAGEMENT_FORCE_DENY_TOOLS = new Set(["bash", "shell", "terminal", "terminal-command-runs"]);
const DEFAULT_MANAGED_PROJECT_ID = "default-project";

export interface ManagementEmbedContext {
  user: {
    id: string;
    rootUserId: string;
    roles: string[];
    permissions: string[];
  };
  projects: { id: string; name: string; role?: string; root?: string }[];
  tools?: { allow?: string[]; deny?: string[]; permissions?: Record<string, boolean> };
  sandbox?: { pythonExecutable?: string; env?: Record<string, string> };
  expiresAt?: string;
}

export interface ManagementEmbedRuntime {
  enabled: boolean;
  projectRoot: string;
  authenticate(token: string): Promise<ManagementEmbedContext>;
}

export interface ManagementEmbedRequest {
  mode?: "management";
  token?: string;
}

export function readManagementEmbedRequest(headers: Record<string, string | string[] | undefined>, query?: Record<string, unknown>): ManagementEmbedRequest {
  const modeHeader = firstHeader(headers[MANAGEMENT_EMBED_MODE_HEADER]);
  const tokenHeader = firstHeader(headers[MANAGEMENT_EMBED_TOKEN_HEADER]);
  const embedQuery = typeof query?.["embed"] === "string" ? query["embed"].trim() : undefined;
  const tokenQuery = typeof query?.["token"] === "string" ? query["token"].trim() : undefined;
  const isManagement = modeHeader === "management" || embedQuery === "management" || tokenHeader !== undefined || tokenQuery !== undefined;
  const token = tokenHeader ?? tokenQuery;
  return {
    ...(isManagement ? { mode: "management" as const } : {}),
    ...(token === undefined ? {} : { token }),
  };
}

export async function managementContextForRequest(request: FastifyRequest, runtime: ManagementEmbedRuntime | undefined): Promise<ManagementEmbedContext | undefined> {
  const embed = readManagementEmbedRequest(request.headers, isRecord(request.query) ? request.query : undefined);
  if (embed.mode !== "management") return undefined;
  if (runtime?.enabled !== true) throw new Error("Management embed mode is not configured");
  if (embed.token === undefined || embed.token === "") throw new Error("Management embed token is required");
  return runtime.authenticate(embed.token);
}

export function createManagementEmbedRuntime(
  config: PiWebManagementEmbedConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
): ManagementEmbedRuntime | undefined {
  if (config?.enabled !== true) return undefined;
  const introspectionUrl = config.auth?.introspectionUrl?.trim();
  const configuredServiceSecretEnv = config.auth?.serviceSecretEnv?.trim();
  const serviceSecretEnv = configuredServiceSecretEnv !== undefined && configuredServiceSecretEnv !== "" ? configuredServiceSecretEnv : "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN";
  const serviceSecret = env[serviceSecretEnv]?.trim();
  if (introspectionUrl === undefined || introspectionUrl === "" || serviceSecret === undefined || serviceSecret === "") {
    return {
      enabled: true,
      projectRoot: config.projectRoot ?? defaultManagedProjectRoot(homeDir),
      authenticate: () => Promise.reject(new Error("Management embed auth is not configured")),
    };
  }
  return {
    enabled: true,
    projectRoot: config.projectRoot ?? defaultManagedProjectRoot(homeDir),
    authenticate: async (token) => introspectManagementToken(introspectionUrl, serviceSecret, token),
  };
}

export async function managedProjectPath(projectRoot: string, rootUserId: string, projectId: string): Promise<string> {
  const root = await ensureRealDirectory(projectRoot);
  const requested = join(root, safePathSegment(rootUserId), safePathSegment(projectId));
  ensureInside(root, requested);
  await mkdir(requested, { recursive: true });
  const target = await realpath(requested);
  ensureInside(root, target);
  return target;
}

export async function projectFromManagedEmbedContext(projectRoot: string, context: ManagementEmbedContext, projectId: string): Promise<Project> {
  const entry = authorizedManagedProjects(context).find((project) => project.id === projectId);
  if (entry === undefined) throw new Error("Project is not authorized for this management session");
  const path = context.projects.length === 0 && entry.id === DEFAULT_MANAGED_PROJECT_ID
    ? await defaultManagedProjectPath(projectRoot, context.user.id)
    : await pathForManagedProjectEntry(projectRoot, context, entry);
  return { id: entry.id, name: entry.name !== "" ? entry.name : entry.id, path, createdAt: new Date(0).toISOString() };
}

export async function projectsFromManagedEmbedContext(projectRoot: string, context: ManagementEmbedContext): Promise<Project[]> {
  return Promise.all(authorizedManagedProjects(context).map((project) => projectFromManagedEmbedContext(projectRoot, context, project.id)));
}

export async function assertManagedCwd(projectRoot: string, context: ManagementEmbedContext, cwd: string): Promise<string> {
  const root = await ensureRealDirectory(projectRoot);
  const requested = await realpath(resolve(cwd));
  ensureInside(root, requested);
  const authorizedRoots = context.projects.length === 0
    ? [await defaultManagedProjectPath(root, context.user.id)]
    : await Promise.all(context.projects.map(async (project) => {
      const projectRootOverride = project.root?.trim();
      if (projectRootOverride !== undefined && projectRootOverride !== "") return realpath(resolve(projectRootOverride));
      return managedProjectPath(root, context.user.rootUserId, project.id);
    }));
  if (!authorizedRoots.some((authorized) => isInside(authorized, requested))) {
    throw new Error("Path is outside the managed project sandbox");
  }
  return requested;
}

export function managementToolAllowed(context: ManagementEmbedContext, tool: string): boolean {
  if (MANAGEMENT_FORCE_DENY_TOOLS.has(tool)) return false;
  const deny = new Set(context.tools?.deny ?? []);
  if (deny.has(tool)) return false;
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

async function introspectManagementToken(url: string, serviceSecret: string, token: string): Promise<ManagementEmbedContext> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-pi-web-embed-secret": serviceSecret },
    body: JSON.stringify({ token }),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !isRecord(payload) || payload["active"] !== true) throw new Error("Management embed token is invalid");
  return parseIntrospectionPayload(payload);
}

function parseIntrospectionPayload(payload: Record<string, unknown>): ManagementEmbedContext {
  const user = payload["user"];
  const projects = payload["projects"];
  if (!isRecord(user) || !Array.isArray(projects)) throw new Error("Management embed introspection response is invalid");
  const context: ManagementEmbedContext = {
    user: {
      id: stringField(user, "id"),
      rootUserId: stringField(user, "rootUserId"),
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
  return {
    id: stringField(value, "id"),
    name: stringField(value, "name"),
    ...(typeof value["role"] === "string" ? { role: value["role"] } : {}),
    ...(typeof value["root"] === "string" ? { root: value["root"] } : {}),
  };
}

async function ensureRealDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}

async function pathForManagedProjectEntry(
  projectRoot: string,
  context: ManagementEmbedContext,
  project: ManagementEmbedContext["projects"][number],
): Promise<string> {
  const entryRoot = project.root?.trim();
  if (entryRoot !== undefined && entryRoot !== "") return assertManagedCwd(projectRoot, context, entryRoot);
  return managedProjectPath(projectRoot, context.user.rootUserId, project.id);
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

async function defaultManagedProjectPath(projectRoot: string, userId: string): Promise<string> {
  const root = await ensureRealDirectory(projectRoot);
  const requested = join(root, safePathSegment(userId));
  ensureInside(root, requested);
  await mkdir(requested, { recursive: true });
  const target = await realpath(requested);
  ensureInside(root, target);
  return target;
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

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") throw new Error(`Management embed ${key} is required`);
  return field.trim();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
