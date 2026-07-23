import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SessionPinScope =
  | { mode: "normal"; cwd: string }
  | { mode: "management"; rootUserId: string; userId: string; cwd: string };

interface SessionPinFile {
  version: 1;
  scopes: Record<string, string[]>;
}

export class SessionPinStore {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(scope: SessionPinScope): Promise<string[]> {
    const data = await this.read();
    return [...(data.scopes[scopeKey(scope)] ?? [])];
  }

  async set(scope: SessionPinScope, sessionId: string, pinned: boolean): Promise<string[]> {
    return this.exclusive(async () => {
      const data = await this.read();
      const key = scopeKey(scope);
      const current = new Set(data.scopes[key] ?? []);
      if (pinned) current.add(sessionId);
      else current.delete(sessionId);
      const sessionIds = [...current];
      if (sessionIds.length === 0) data.scopes = withoutScope(data.scopes, key);
      else data.scopes[key] = sessionIds;
      await this.write(data);
      return sessionIds;
    });
  }

  async prune(scope: SessionPinScope, validSessionIds: ReadonlySet<string>): Promise<string[]> {
    return this.exclusive(async () => {
      const data = await this.read();
      const key = scopeKey(scope);
      const sessionIds = (data.scopes[key] ?? []).filter((sessionId) => validSessionIds.has(sessionId));
      if (sessionIds.length === 0) data.scopes = withoutScope(data.scopes, key);
      else data.scopes[key] = sessionIds;
      await this.write(data);
      return sessionIds;
    });
  }

  private async read(): Promise<SessionPinFile> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!isRecord(value) || value["version"] !== 1 || !isRecord(value["scopes"])) return emptyPinFile();
      const scopes: Record<string, string[]> = {};
      for (const [key, rawSessionIds] of Object.entries(value["scopes"])) {
        if (Array.isArray(rawSessionIds)) {
          const sessionIds = rawSessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId !== "");
          if (sessionIds.length === rawSessionIds.length) scopes[key] = [...new Set(sessionIds)];
        }
      }
      return { version: 1, scopes };
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) return emptyPinFile();
      if (error instanceof SyntaxError) return emptyPinFile();
      throw error;
    }
  }

  private async write(data: SessionPinFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tempPath = join(dirname(this.filePath), `.session-pins.${String(process.pid)}.${Date.now().toString()}.${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.filePath);
    } catch (error: unknown) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function scopeKey(scope: SessionPinScope): string {
  return scope.mode === "normal"
    ? JSON.stringify(["normal", scope.cwd])
    : JSON.stringify(["management", scope.rootUserId, scope.userId, scope.cwd]);
}

function emptyPinFile(): SessionPinFile {
  return { version: 1, scopes: {} };
}

function withoutScope(scopes: Record<string, string[]>, removedKey: string): Record<string, string[]> {
  return Object.fromEntries(Object.entries(scopes).filter(([key]) => key !== removedKey));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
