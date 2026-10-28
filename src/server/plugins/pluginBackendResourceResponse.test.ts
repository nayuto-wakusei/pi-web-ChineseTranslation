import { Readable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { pluginResourceError, pluginResourceHeaders, pluginResourceRange, sendPluginResourceResponse } from "./pluginBackendResourceResponse.js";

describe("resource response trust boundary", () => {
  it.each(["application/pdf", "Application/PDF ; charset=utf-8"])("keeps native PDF delivery unsandboxed for %s", async (contentType) => {
    const app = Fastify();
    app.get("/", async (_request, reply) => sendPluginResourceResponse(reply, {
      statusCode: 200, body: Readable.from([Buffer.from("%PDF-1.4")]), headers: { "content-type": contentType },
    }, new AbortController().signal));
    try {
      const response = await app.inject("/");
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(response.headers["content-security-policy"]).not.toContain("sandbox");
      expect(response.headers["content-security-policy"]).toContain("script-src 'none'");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    } finally { await app.close(); }
  });

  it.each([
    { "content-type": "text/html\r\nx-danger: yes" },
    { "content-type": "text/html", "content-length": "-1" },
    { "content-type": "text/html", "content-length": "9007199254740992" },
    { "content-type": "text/html", "content-range": "bytes 5-1/10" },
    { "content-type": "text/html", "accept-ranges": "other" },
  ])("rejects malformed remote metadata %j", (headers) => {
    expect(() => pluginResourceHeaders(200, headers)).toThrow();
  });
  it("requires coherent partial response ranges and lengths", () => {
    expect(() => pluginResourceHeaders(206, { "content-type": "image/png" })).toThrow();
    expect(() => pluginResourceHeaders(206, { "content-type": "image/png", "content-range": "bytes 0-4/4" })).toThrow();
    expect(() => pluginResourceHeaders(206, { "content-type": "image/png", "content-range": "bytes 0-3/4", "content-length": "3" })).toThrow();
  });
  it.each(["bytes=0-\r\nx-test: bad", "x".repeat(257)])("rejects unsafe Range request %j", (range) => {
    expect(() => pluginResourceRange(range)).toThrow();
  });
  it.each([416, 500, 302])("forces bounded inert JSON instead of upstream error documents (%s)", async (statusCode) => {
    const app = Fastify();
    const source = new Readable({ read() { throw new Error("Error document must not be read"); } });
    app.get("/", async (_request, reply) => {
      try {
        return await sendPluginResourceResponse(reply, {
          statusCode, body: source, headers: { "content-type": "text/html", "content-length": "999999999", "content-range": statusCode === 416 ? "bytes */10" : undefined },
        }, new AbortController().signal);
      } catch (error) { return await pluginResourceError(reply, 502, error); }
    });
    try {
      const response = await app.inject("/");
      expect(response.statusCode).toBe(statusCode === 302 ? 502 : statusCode);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["content-length"]).not.toBe("999999999");
      expect(response.headers["content-security-policy"]).toContain("sandbox;");
      expect(response.json()).toHaveProperty("error");
      expect(source.destroyed).toBe(true);
      if (statusCode === 416) expect(response.headers["content-range"]).toBe("bytes */10");
    } finally { await app.close(); }
  });
});
