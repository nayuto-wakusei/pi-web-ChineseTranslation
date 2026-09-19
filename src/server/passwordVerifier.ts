import { createHmac, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";

export class PasswordVerificationBusyError extends Error {
  constructor() { super("认证服务繁忙，请稍后重试"); }
}

/** Bound expensive work separately from HTTP concurrency. Never retain plaintext in the cache. */
export class PasswordVerifier {
  private readonly key = randomBytes(32);
  private readonly successes = new Map<string, number>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  private generation = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly verify: (password: string, hash: string) => Promise<boolean> = verifyPassword,
  ) {}

  clear(): void {
    this.generation++;
    this.successes.clear();
    // In-flight work stays counted until completion; old generations cannot populate the cache.
  }

  async check(password: string, hash: string, cache = false): Promise<boolean> {
    const generation = this.generation;
    const key = createHmac("sha256", this.key).update(JSON.stringify([generation, hash, password])).digest("hex");
    if (cache) {
      const expires = this.successes.get(key);
      if (expires !== undefined && expires > this.now()) return true;
      this.successes.delete(key);
    }
    const existing = this.pending.get(key);
    if (existing !== undefined) return existing;
    if (this.active >= 4 && this.queue.length >= 32) throw new PasswordVerificationBusyError();
    const operation = this.run(password, hash).then((valid) => {
      if (generation !== this.generation) return false;
      if (valid && cache) {
        if (this.successes.size >= 128) {
          const oldest = this.successes.keys().next().value;
          if (oldest !== undefined) this.successes.delete(oldest);
        }
        this.successes.set(key, this.now() + 60_000);
      }
      return valid;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, operation);
    return operation;
  }

  private async run(password: string, hash: string): Promise<boolean> {
    if (this.active >= 4) await new Promise<void>((resolve) => { this.queue.push(resolve); });
    else this.active++;
    try { return await this.verify(password, hash); }
    finally {
      const next = this.queue.shift();
      if (next !== undefined) next();
      else this.active--;
    }
  }
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, hashValue, extra] = stored.split("$");
  const iterations = Number(iterationsValue);
  if (algorithm !== "pbkdf2-sha256" || extra !== undefined || saltValue === undefined || hashValue === undefined
    || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2_147_483_647) return false;
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(hashValue, "base64url");
  // Existing configurations can contain hashes generated with a different salt length.
  if (expected.length === 0) return false;
  const actual = await new Promise<Buffer>((resolve, reject) => {
    pbkdf2(password, salt, iterations, expected.length, "sha256", (error, result) => {
      if (error !== null) reject(error);
      else resolve(result);
    });
  });
  return timingSafeEqual(actual, expected);
}
