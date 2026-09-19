import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "../shared/piWebConfigParsing.js";
import type { PiWebConfigService } from "./configRoutes.js";
import { createFixedTtlSessionStore, readCookie, type FixedTtlSessionStore } from "./httpSessions.js";
import { managementContextForRequest, readManagementEmbedRequest, type ManagementEmbedRuntime } from "./managementEmbed.js";

import { PasswordVerifier, PasswordVerificationBusyError } from "./passwordVerifier.js";

export const NORMAL_AUTH_COOKIE = "pi_web_normal_session";
const HASH_ALGORITHM = "pbkdf2-sha256";
const HASH_ITERATIONS = 120_000;
const HASH_BYTES = 32;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;
const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitConfig = {
  maxFailures: 5,
  windowMs: 60_000,
  maxTrackedAddresses: 10_000,
};

export interface NormalAuthStatus {
  configured: boolean;
  authenticated: boolean;
}

type SetupResult = { status: "created"; sessionId: string } | { status: "already-configured" };
type ChangePasswordResult = { status: "changed"; sessionId: string } | { status: "unauthorized" } | { status: "invalid-password" };

interface LoginRateLimitConfig {
  maxFailures: number;
  windowMs: number;
  maxTrackedAddresses: number;
}

interface NormalAuthRouteOptions {
  now?: () => number;
  rateLimit?: LoginRateLimitConfig;
}

export class NormalModeAuthService {
  private readonly sessions: FixedTtlSessionStore<true>;
  private readonly verifier: PasswordVerifier;
  private observedHash: string | undefined;

  constructor(
    private readonly config: Pick<PiWebConfigService, "read" | "write">,
    now: () => number = () => Date.now(),
    newSessionId: () => string = () => randomUUID(),
  ) {
    this.verifier = new PasswordVerifier(now);
    this.sessions = createFixedTtlSessionStore(SESSION_TTL_MS, now, newSessionId);
  }

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
    await this.passwordHash();
    this.sessions.clear();
    return { status: "created", sessionId: this.createSession() };
  }

  async login(password: unknown): Promise<string | undefined> {
    const passwordHash = await this.passwordHash();
    if (passwordHash === undefined || !(await this.verifier.check(requirePassword(password, "password"), passwordHash)) || await this.passwordHash() !== passwordHash) return undefined;
    return this.createSession();
  }

  async changePassword(cookieHeader: string | string[] | undefined, currentPassword: unknown, newPassword: unknown): Promise<ChangePasswordResult> {
    await this.passwordHash();
    if (!this.isAuthenticated(cookieHeader)) return { status: "unauthorized" };
    const current = await this.config.read();
    const passwordHash = current.config.normalAuth?.passwordHash;
    if (passwordHash === undefined || !(await this.verifier.check(requirePassword(currentPassword, "currentPassword"), passwordHash)) || await this.passwordHash() !== passwordHash) return { status: "invalid-password" };
    await this.config.write({ ...current.config, normalAuth: { passwordHash: hashPassword(requirePassword(newPassword, "newPassword")) } });
    await this.passwordHash();
    this.sessions.clear();
    return { status: "changed", sessionId: this.createSession() };
  }

  async authorize(cookieHeader: string | string[] | undefined, authorizationHeader?: string | string[]): Promise<"authorized" | "setup-required" | "login-required"> {
    const passwordHash = await this.passwordHash();
    if (passwordHash === undefined) return "setup-required";
    if (this.isAuthenticated(cookieHeader)) return "authorized";
    const token = bearerToken(authorizationHeader);
    if (token !== undefined && await this.verifier.check(token, passwordHash, true) && await this.passwordHash() === passwordHash) return "authorized";
    return "login-required";
  }

  private async passwordHash(): Promise<string | undefined> {
    const hash = (await this.config.read()).config.normalAuth?.passwordHash;
    if (hash !== this.observedHash) {
      this.observedHash = hash;
      this.verifier.clear();
      this.sessions.clear();
    }
    return hash;
  }

  private createSession(): string {
    return this.sessions.create(true).id;
  }

  private isAuthenticated(cookieHeader: string | string[] | undefined): boolean {
    const sessionId = readCookie(cookieHeader, NORMAL_AUTH_COOKIE);
    if (sessionId === undefined) return false;
    return this.sessions.read(sessionId) === true;
  }
}

export function registerNormalAuthRoutes(app: FastifyInstance, auth: NormalModeAuthService, options: NormalAuthRouteOptions = {}): FailedLoginAttemptTracker {
  const loginAttempts = new FailedLoginAttemptTracker(options.rateLimit ?? DEFAULT_LOGIN_RATE_LIMIT, options.now ?? (() => Date.now()));

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
      await reply.code(error instanceof PasswordVerificationBusyError ? 503 : 400).send({ error: errorMessage(error) });
      return;
    }
  });

  app.post<{ Body: unknown }>("/api/normal-auth/login", async (request, reply) => {
    const retryAfterSeconds = loginAttempts.retryAfterSeconds(request.ip);
    if (retryAfterSeconds !== undefined) {
      await sendLoginRateLimit(reply, retryAfterSeconds);
      return;
    }
    try {
      const sessionId = await auth.login(bodyRecord(request.body)["password"]);
      if (sessionId === undefined) {
        loginAttempts.recordFailure(request.ip);
        await reply.code(401).send({ error: "Invalid ordinary mode password" });
        return;
      }
      loginAttempts.clear(request.ip);
      setSessionCookie(reply, sessionId);
      return { accepted: true };
    } catch (error) {
      await reply.code(error instanceof PasswordVerificationBusyError ? 503 : 400).send({ error: errorMessage(error) });
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
      await reply.code(error instanceof PasswordVerificationBusyError ? 503 : 400).send({ error: errorMessage(error) });
      return;
    }
  });
  return loginAttempts;
}

export class FailedLoginAttemptTracker {
  private readonly failuresByAddress = new Map<string, number[]>();

  constructor(
    private readonly config: LoginRateLimitConfig,
    private readonly now: () => number,
  ) {}

  retryAfterSeconds(address: string): number | undefined {
    const now = this.now();
    const failures = this.currentFailures(address, now);
    if (failures.length < this.config.maxFailures) return undefined;
    return Math.max(1, Math.ceil(((failures[0] ?? now) + this.config.windowMs - now) / 1000));
  }

  recordFailure(address: string): void {
    const now = this.now();
    const failures = this.currentFailures(address, now);
    if (!this.failuresByAddress.has(address)) this.makeRoom(now);
    this.failuresByAddress.set(address, [...failures, now]);
  }

  clear(address: string): void {
    this.failuresByAddress.delete(address);
  }

  private currentFailures(address: string, now: number): number[] {
    const failures = this.failuresByAddress.get(address);
    if (failures === undefined) return [];
    const windowStart = now - this.config.windowMs;
    const current = failures.filter((failedAt) => failedAt > windowStart);
    if (current.length === 0) this.failuresByAddress.delete(address);
    else if (current.length !== failures.length) this.failuresByAddress.set(address, current);
    return current;
  }

  private makeRoom(now: number): void {
    if (this.failuresByAddress.size < this.config.maxTrackedAddresses) return;
    for (const address of this.failuresByAddress.keys()) this.currentFailures(address, now);
    if (this.failuresByAddress.size < this.config.maxTrackedAddresses) return;
    const oldestAddress = this.failuresByAddress.keys().next().value;
    if (oldestAddress !== undefined) this.failuresByAddress.delete(oldestAddress);
  }
}

export function registerNormalModeAuthGate(app: FastifyInstance, auth: NormalModeAuthService, managementEmbed: ManagementEmbedRuntime | undefined, loginAttempts = new FailedLoginAttemptTracker(DEFAULT_LOGIN_RATE_LIMIT, () => Date.now())): void {
  app.addHook("preValidation", async (request, reply) => {
    if (!requiresNormalAuth(request)) return;
    if (isManagementRequest(request)) {
      try {
        if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) {
          if (!allowsManagementRequest(request)) {
            await reply.code(403).send({ error: "管理嵌入模式不允许访问此接口" });
          }
          return;
        }
      } catch (error) {
        await reply.code(401).send({ error: errorMessage(error) });
        return;
      }
    }
    const bearer = bearerToken(request.headers.authorization);
    if (bearer !== undefined) {
      const retryAfterSeconds = loginAttempts.retryAfterSeconds(request.ip);
      if (retryAfterSeconds !== undefined) {
        await sendLoginRateLimit(reply, retryAfterSeconds);
        return;
      }
    }
    let authorization;
    try { authorization = await auth.authorize(request.headers.cookie, request.headers.authorization); }
    catch (error) {
      if (!(error instanceof PasswordVerificationBusyError)) throw error;
      await reply.header("retry-after", "1").code(503).send({ error: error.message });
      return;
    }
    if (authorization === "authorized") {
      if (bearer !== undefined) loginAttempts.clear(request.ip);
      return;
    }
    if (bearer !== undefined) loginAttempts.recordFailure(request.ip);
    const error = authorization === "setup-required" ? "Ordinary mode password setup is required" : "Ordinary mode login is required";
    await reply.code(401).send({ error });
  });
}

function requiresNormalAuth(request: FastifyRequest): boolean {
  const pathname = new URL(request.url, "http://pi-web.local").pathname;
  return pathname === "/pi-web-plugins/manifest.json"
    || (pathname.startsWith("/api/") && !pathname.startsWith("/api/normal-auth/"));
}

function allowsManagementRequest(request: FastifyRequest): boolean {
  const pathname = new URL(request.url, "http://pi-web.local").pathname;
  if (pathname === "/api/machines") return request.method === "GET" || request.method === "HEAD";
  if (/^\/api\/machines\/local(?:\/(?:health|runtime))?$/u.test(pathname)) {
    return request.method === "GET" || request.method === "HEAD";
  }
  const path = pathname.startsWith("/api/machines/local/") ? pathname.slice("/api/machines/local".length) : pathname.slice("/api".length);
  // Only local APIs that preserve management context may bypass normal auth.
  return /^\/(?:projects|files|auth|sessions|activity|status|events|notices|terminal-command-runs)(?:\/|$)/u.test(path)
    || /^\/sessiond\/(?:health|runtime)$/u.test(path);
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

async function sendLoginRateLimit(reply: FastifyReply, retryAfterSeconds: number): Promise<void> {
  reply.header("retry-after", String(retryAfterSeconds));
  await reply.code(429).send({
    error: "Too many failed ordinary mode login attempts",
    retryAfterSeconds,
  });
}

function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.header("set-cookie", `${NORMAL_AUTH_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(SESSION_MAX_AGE_SECONDS)}`);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_BYTES, "sha256");
  return `${HASH_ALGORITHM}$${String(HASH_ITERATIONS)}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function requirePassword(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${field} must be a non-empty string`);
  return value;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new Error("Request body must be an object");
  return body;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
