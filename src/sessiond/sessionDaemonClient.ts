import http from "node:http";
import https from "node:https";
import type { Readable } from "node:stream";
import { WebSocket } from "ws";
import { isHostAbsoluteAgentDir } from "../config.js";
import type { ActiveAgentProfileDescriptor } from "../shared/apiTypes.js";
import { parsePiWebRuntimeComponent } from "../shared/piWebStatusParsing.js";
import { sessiondHttpUrl, sessiondSocketPath } from "./config.js";
import { normalizeSessionDaemonRequestError } from "./sessionDaemonErrors.js";
import { parseLegacyActiveAgentProfileDescriptor, publicActiveAgentProfileDescriptor } from "./activeAgentProfile.js";

const SESSIOND_SOCKET_AGENT = new http.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 32 });

export type SessionDaemonAgentProfileResult =
  | { status: "available"; profile: ActiveAgentProfileDescriptor }
  | { status: "unavailable"; error: string }
  | { status: "invalid"; error: string };

export interface SessionDaemonClientOptions {
  baseUrl?: string;
  /** Explicit sockets must not inherit a client URL for another daemon. */
  socketPath?: string;
}

export interface SessionDaemonRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface SessionDaemonStreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}

export interface SessionDaemonRequestClient {
  request(method: string, path: string, body?: unknown, headersOrOptions?: Record<string, string> | SessionDaemonRequestOptions, signal?: AbortSignal): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
}

/** Talks to the local session daemon. A dead socket fails immediately, so there is no default request deadline; a busy agent turn is not a hang. Callers may still pass an AbortSignal. */
export class SessionDaemonClient {
  private readonly baseUrl: string | undefined;
  private readonly socketPath: string;

  constructor(options: SessionDaemonClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? (options.socketPath === undefined ? sessiondHttpUrl() : undefined);
    this.socketPath = options.socketPath ?? sessiondSocketPath();
  }

  async request(method: string, path: string, body?: unknown, headersOrOptions: Record<string, string> | SessionDaemonRequestOptions = {}, signal?: AbortSignal): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    const options = requestOptions(headersOrOptions, signal);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (this.baseUrl !== undefined && this.baseUrl !== "") return this.requestUrl(method, path, payload, options.headers, options.signal);
    return this.requestSocket(method, path, payload, options.headers, options.signal);
  }

  /** Stream binary resources without UTF-8 decoding or buffering the response. */
  requestStream(path: string, options: SessionDaemonRequestOptions = {}): Promise<SessionDaemonStreamResponse> {
    return new Promise((resolve, reject) => {
      const onResponse = (response: http.IncomingMessage): void => {
        resolve({
          statusCode: response.statusCode ?? 500,
          headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""])),
          body: response,
        });
      };
      const requestOptions: http.RequestOptions = {
        method: "GET",
        headers: { ...options.headers, "accept-encoding": "identity" },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      const url = this.baseUrl === undefined || this.baseUrl === "" ? undefined : new URL(path, this.baseUrl);
      const request = url === undefined
        ? http.request({ ...requestOptions, agent: SESSIOND_SOCKET_AGENT, socketPath: this.socketPath, path }, onResponse)
        : (url.protocol === "https:" ? https : http).request(url, requestOptions, onResponse);
      request.on("error", (error) => { reject(normalizeSessionDaemonRequestError(error, options.signal)); });
      request.end();
    });
  }

  getActiveAgentProfile(): Promise<SessionDaemonAgentProfileResult> {
    return getSessionDaemonActiveAgentProfile(this);
  }

  connectWebSocket(path: string, headersOrOptions: Record<string, string> | { headers?: Record<string, string>; maxPayload?: number } = {}, maxPayload?: number): WebSocket {
    const options = isHeaders(headersOrOptions)
      ? { headers: headersOrOptions, ...(maxPayload === undefined ? {} : { maxPayload }) }
      : headersOrOptions;
    if (this.baseUrl !== undefined && this.baseUrl !== "") {
      const url = new URL(path, this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url, options);
    }
    return new WebSocket(`ws+unix:${this.socketPath}:${path}`, options);
  }

  private async requestUrl(method: string, path: string, payload?: string, headers: Record<string, string> = {}, signal?: AbortSignal) {
    const init: RequestInit = { method, headers, ...(signal === undefined ? {} : { signal }) };
    if (payload !== undefined && payload !== "") {
      init.headers = { ...headers, "content-type": "application/json" };
      init.body = payload;
    }
    try {
      const response = await fetch(new URL(path, this.baseUrl), init);
      return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    } catch (error) {
      throw normalizeSessionDaemonRequestError(error, signal);
    }
  }

  private requestSocket(method: string, path: string, payload?: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          ...(signal === undefined ? {} : { signal }),
          agent: SESSIOND_SOCKET_AGENT,
          headers: payload !== undefined && payload !== ""
            ? { ...headers, "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : headers,
        },
        (response) => {
          const chunks: Uint8Array[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 500,
              headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""])),
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("error", (error) => {
        reject(normalizeSessionDaemonRequestError(error, signal));
      });
      if (payload !== undefined && payload !== "") request.write(payload);
      request.end();
    });
  }
}

function requestOptions(headersOrOptions: Record<string, string> | SessionDaemonRequestOptions, signal: AbortSignal | undefined): SessionDaemonRequestOptions {
  return isHeaders(headersOrOptions)
    ? { headers: headersOrOptions, ...(signal === undefined ? {} : { signal }) }
    : headersOrOptions;
}

function isHeaders(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((header) => typeof header === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getSessionDaemonActiveAgentProfile(client: SessionDaemonRequestClient): Promise<SessionDaemonAgentProfileResult> {
  let response: Awaited<ReturnType<SessionDaemonRequestClient["request"]>>;
  try {
    response = await client.request("GET", "/runtime");
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { status: "unavailable", error: `session daemon runtime request returned HTTP ${String(response.statusCode)}` };
  }

  let value: unknown;
  try {
    value = response.body === "" ? undefined : JSON.parse(response.body);
  } catch {
    return { status: "invalid", error: "session daemon runtime response was not valid JSON" };
  }

  if (isRecord(value)) {
    const legacy = parseLegacyActiveAgentProfileDescriptor(value["activeAgentProfile"]);
    if (legacy !== undefined) value = { ...value, activeAgentProfile: publicActiveAgentProfileDescriptor(legacy) };
  }
  const runtime = parsePiWebRuntimeComponent(value);
  if (runtime?.component !== "sessiond") {
    return { status: "invalid", error: "session daemon runtime response was invalid" };
  }
  if (runtime.activeAgentProfile === undefined) {
    return { status: "invalid", error: "session daemon runtime response did not include an active agent profile" };
  }
  if (!isHostAbsoluteAgentDir(runtime.activeAgentProfile.dir)) {
    return { status: "invalid", error: "session daemon active agent profile was not valid for this host" };
  }
  return { status: "available", profile: runtime.activeAgentProfile };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
