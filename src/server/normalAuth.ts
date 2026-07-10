import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "../shared/piWebConfigParsing.js";
import type { PiWebConfigService } from "./configRoutes.js";
import { createFixedTtlSessionStore, readCookie, type FixedTtlSessionStore } from "./httpSessions.js";
import { managementContextForRequest, readManagementEmbedRequest, type ManagementEmbedRuntime } from "./managementEmbed.js";

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

  constructor(
    private readonly config: Pick<PiWebConfigService, "read" | "write">,
    now: () => number = () => Date.now(),
    newSessionId: () => string = () => randomUUID(),
  ) {
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
      await reply.code(400).send({ error: errorMessage(error) });
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
        if (await managementContextForRequest(request, managementEmbed, reply) !== undefined) return;
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
    const authorization = await auth.authorize(request.headers.cookie, request.headers.authorization);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
