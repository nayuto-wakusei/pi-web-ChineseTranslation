import { join } from "node:path";
import { piWebDataDir } from "../config.js";

export function sessiondSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["PI_WEB_SESSIOND_SOCKET"] ?? join(piWebDataDir(env), "sessiond.sock");
}

export function sessiondHttpUrl(): string | undefined {
  return process.env["PI_WEB_SESSIOND_URL"];
}

/** Mirrors the socket or TCP listener selected at daemon startup. */
export function sessiondEndpointDescription(env: NodeJS.ProcessEnv = process.env): string {
  const port = env["PI_WEB_SESSIOND_PORT"];
  if (port !== undefined && port !== "") return `${env["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1"}:${port}`;
  return sessiondSocketPath(env);
}
