export interface HttpSession {
  id: string;
  maxAgeSeconds: number;
}

export interface FixedTtlSessionStore<T> {
  create: (value: T) => HttpSession;
  read: (id: string) => T | undefined;
  clear: () => void;
}

export function createFixedTtlSessionStore<T>(
  ttlMs: number,
  now: () => number,
  randomSessionId: () => string,
): FixedTtlSessionStore<T> {
  const sessions = new Map<string, { value: T; expiresAt: number }>();
  return {
    create: (value) => {
      const id = randomSessionId();
      sessions.set(id, { value, expiresAt: now() + ttlMs });
      return { id, maxAgeSeconds: ttlMs / 1000 };
    },
    read: (id) => {
      const session = sessions.get(id);
      if (session === undefined) return undefined;
      if (session.expiresAt > now()) return session.value;
      sessions.delete(id);
      return undefined;
    },
    clear: () => { sessions.clear(); },
  };
}

export function readCookie(header: string | string[] | undefined, name: string): string | undefined {
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
