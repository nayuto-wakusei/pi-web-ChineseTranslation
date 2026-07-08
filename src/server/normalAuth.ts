import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "../shared/piWebConfigParsing.js";
import type { PiWebConfigService } from "./configRoutes.js";
import { managementContextForRequest, readManagementEmbedRequest, type ManagementEmbedRuntime } from "./managementEmbed.js";

export const NORMAL_AUTH_COOKIE = "pi_web_normal_session";
const HASH_ALGORITHM = "pbkdf2-sha256";
const HASH_ITERATIONS = 120_000;
const HASH_BYTES = 32;
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface NormalAuthStatus {
  configured: boolean;
  authenticated: boolean;
}

type SetupResult = { status: "created"; sessionId: string } | { status: "already-configured" };
type ChangePasswordResult = { status: "changed"; sessionId: string } | { status: "unauthorized" } | { status: "invalid-password" };

export class NormalModeAuthService {
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly config: Pick<PiWebConfigService, "read" | "write">,
    private readonly now: () => number = () => Date.now(),
    private readonly newSessionId: () => string = () => randomUUID(),
  ) {}

  async status(cookieHeader: string | string[] | undefined): Promise<NormalAuthStatus> {
    const passwordHash = await this.passwordHash();
    return {
      configured: passwordHash !== undefined,
      authenticated: passwordHash !== undefined && this.isAuthenticated(cookieHeader),
    };
  }

  async setup(password: unknown): Promise<SetupResult> {
    const current = await this.config.read();
    if (current.config.normalAuth?.passwordHash !== undefined) return { status: "already-configured" };
    const passwordHash = hashPassword(requirePassword(password, "password"));
    await this.config.write({ ...current.config, normalAuth: { passwordHash } });
    this.sessions.clear();
    return { status: "created", sessionId: this.createSession() };
  }

  async login(password: unknown): Promise<string | undefined> {
    const passwordHash = await this.passwordHash();
    if (passwordHash === undefined || !verifyPassword(requirePassword(password, "password"), passwordHash)) return undefined;
    return this.createSession();
  }

  async changePassword(cookieHeader: string | string[] | undefined, currentPassword: unknown, newPassword: unknown): Promise<ChangePasswordResult> {
    if (!this.isAuthenticated(cookieHeader)) return { status: "unauthorized" };
    const current = await this.config.read();
    const passwordHash = current.config.normalAuth?.passwordHash;
    if (passwordHash === undefined || !verifyPassword(requirePassword(currentPassword, "currentPassword"), passwordHash)) return { status: "invalid-password" };
    await this.config.write({ ...current.config, normalAuth: { passwordHash: hashPassword(requirePassword(newPassword, "newPassword")) } });
    this.sessions.clear();
    return { status: "changed", sessionId: this.createSession() };
  }

  async authorize(cookieHeader: string | string[] | undefined, authorizationHeader?: string | string[]): Promise<"authorized" | "setup-required" | "login-required"> {
    const passwordHash = await this.passwordHash();
    if (passwordHash === undefined) return "setup-required";
    if (this.isAuthenticated(cookieHeader)) return "authorized";
    const token = bearerToken(authorizationHeader);
    if (token !== undefined && verifyPassword(token, passwordHash)) return "authorized";
    return "login-required";
  }

  private async passwordHash(): Promise<string | undefined> {
    return (await this.config.read()).config.normalAuth?.passwordHash;
  }

  private createSession(): string {
    const sessionId = this.newSessionId();
    this.sessions.set(sessionId, this.now() + SESSION_MAX_AGE_SECONDS * 1000);
    return sessionId;
  }

  private isAuthenticated(cookieHeader: string | string[] | undefined): boolean {
    const sessionId = readCookie(cookieHeader, NORMAL_AUTH_COOKIE);
    if (sessionId === undefined) return false;
    const expiresAt = this.sessions.get(sessionId);
    if (expiresAt === undefined) return false;
    if (expiresAt > this.now()) return true;
    this.sessions.delete(sessionId);
    return false;
  }
}

export function registerNormalAuthRoutes(app: FastifyInstance, auth: NormalModeAuthService): void {
  app.get("/api/normal-auth/status", async (request) => await auth.status(request.headers.cookie));

  app.post<{ Body: unknown }>("/api/normal-auth/setup", async (request, reply) => {
    try {
      const result = await auth.setup(bodyRecord(request.body)["password"]);
      if (result.status === "already-configured") {
        await reply.code(409).send({ error: "Ordinary mode password is already configured" });
        return;
      }
      setSessionCookie(reply, result.sessionId);
      return { accepted: true };
    } catch (error) {
      await reply.code(400).send({ error: errorMessage(error) });
      return;
    }
  });

  app.post<{ Body: unknown }>("/api/normal-auth/login", async (request, reply) => {
    try {
      const sessionId = await auth.login(bodyRecord(request.body)["password"]);
      if (sessionId === undefined) {
        await reply.code(401).send({ error: "Invalid ordinary mode password" });
        return;
      }
      setSessionCookie(reply, sessionId);
      return { accepted: true };
    } catch (error) {
      await reply.code(400).send({ error: errorMessage(error) });
      return;
    }
  });

  app.post<{ Body: unknown }>("/api/normal-auth/change-password", async (request, reply) => {
    try {
      const body = bodyRecord(request.body);
      const result = await auth.changePassword(request.headers.cookie, body["currentPassword"], body["newPassword"]);
      if (result.status === "unauthorized") {
        await reply.code(401).send({ error: "Ordinary mode login is required" });
        return;
      }
      if (result.status === "invalid-password") {
        await reply.code(401).send({ error: "Invalid ordinary mode password" });
        return;
      }
      setSessionCookie(reply, result.sessionId);
      return { accepted: true };
    } catch (error) {
      await reply.code(400).send({ error: errorMessage(error) });
      return;
    }
  });
}

export function registerNormalModeAuthGate(app: FastifyInstance, auth: NormalModeAuthService, managementEmbed: ManagementEmbedRuntime | undefined): void {
  app.addHook("preValidation", async (request, reply) => {
    if (!requiresNormalAuth(request)) return;
    if (isManagementRequest(request)) {
      try {
        if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return;
      } catch (error) {
        await reply.code(401).send({ error: errorMessage(error) });
        return;
      }
    }
    const authorization = await auth.authorize(request.headers.cookie, request.headers.authorization);
    if (authorization === "authorized") return;
    const error = authorization === "setup-required" ? "Ordinary mode password setup is required" : "Ordinary mode login is required";
    await reply.code(401).send({ error });
  });
}

function requiresNormalAuth(request: FastifyRequest): boolean {
  const pathname = new URL(request.url, "http://pi-web.local").pathname;
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/normal-auth/");
}

function isManagementRequest(request: FastifyRequest): boolean {
  return readManagementEmbedRequest(request.headers, isRecord(request.query) ? request.query : undefined).mode === "management";
}

function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/iu.exec(value.trim());
  return match?.[1]?.trim();
}

function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.header("set-cookie", `${NORMAL_AUTH_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(SESSION_MAX_AGE_SECONDS)}`);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_BYTES, "sha256");
  return `${HASH_ALGORITHM}$${String(HASH_ITERATIONS)}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const parsed = parsePasswordHash(passwordHash);
  if (parsed === undefined) return false;
  const hash = pbkdf2Sync(password, parsed.salt, parsed.iterations, parsed.hash.length, "sha256");
  return hash.length === parsed.hash.length && timingSafeEqual(hash, parsed.hash);
}

function parsePasswordHash(passwordHash: string): { iterations: number; salt: Buffer; hash: Buffer } | undefined {
  const [algorithm, iterationsValue, saltValue, hashValue, extra] = passwordHash.split("$");
  if (algorithm !== HASH_ALGORITHM || extra !== undefined || iterationsValue === undefined || saltValue === undefined || hashValue === undefined) return undefined;
  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations < 1) return undefined;
  return {
    iterations,
    salt: Buffer.from(saltValue, "base64url"),
    hash: Buffer.from(hashValue, "base64url"),
  };
}

function requirePassword(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${field} must be a non-empty string`);
  return value;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new Error("Request body must be an object");
  return body;
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const values = Array.isArray(header) ? header : header === undefined ? [] : [header];
  for (const value of values) {
    for (const part of value.split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (rawName === name) {
        const cookieValue = rawValue.join("=").trim();
        return cookieValue === "" ? undefined : cookieValue;
      }
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
