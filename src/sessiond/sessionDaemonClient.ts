import http from "node:http";
import { WebSocket } from "ws";
import { sessiondHttpUrl, sessiondSocketPath } from "./config.js";

export class SessionDaemonClient {
  private readonly baseUrl = sessiondHttpUrl();
  private readonly socketPath = sessiondSocketPath();

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (this.baseUrl !== undefined && this.baseUrl !== "") return this.requestUrl(method, path, payload, headers);
    return this.requestSocket(method, path, payload, headers);
  }

  connectWebSocket(path: string, headers: Record<string, string> = {}): WebSocket {
    if (this.baseUrl !== undefined && this.baseUrl !== "") {
      const url = new URL(path, this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url, { headers });
    }
    return new WebSocket(`ws+unix:${this.socketPath}:${path}`, { headers });
  }

  private async requestUrl(method: string, path: string, payload?: string, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers };
    if (payload !== undefined && payload !== "") {
      init.headers = { ...headers, "content-type": "application/json" };
      init.body = payload;
    }
    const response = await fetch(new URL(path, this.baseUrl), init);
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }

  private requestSocket(method: string, path: string, payload?: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
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
      request.on("error", reject);
      if (payload !== undefined && payload !== "") request.write(payload);
      request.end();
    });
  }
}
