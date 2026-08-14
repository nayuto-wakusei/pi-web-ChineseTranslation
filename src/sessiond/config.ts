import { join } from "node:path";
import { piWebDataDir } from "../config.js";

export function sessiondSocketPath(): string {
  return process.env["PI_WEB_SESSIOND_SOCKET"] ?? join(piWebDataDir(), "sessiond.sock");
}

export function sessiondHttpUrl(): string | undefined {
  return process.env["PI_WEB_SESSIOND_URL"];
}

export function sessiondEndpointDescription(env: NodeJS.ProcessEnv = process.env): string {
  const port = env["PI_WEB_SESSIOND_PORT"];
  if (port !== undefined && port !== "") return `${env["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1"}:${port}`;
  return env["PI_WEB_SESSIOND_SOCKET"] ?? join(piWebDataDir(env), "sessiond.sock");
}
