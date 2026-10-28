import { describe, expect, it } from "vitest";
import { parsePluginResourceMetadata } from "./pluginResourceMetadata.js";

describe("plugin resource HTTP metadata", () => {
  it("preserves valid MIME parameters, defaults to 200, and drops non-public fields", () => {
    expect(parsePluginResourceMetadata({
      contentType: 'application/vnd.example+zip; title="a\\"b"', contentLength: 0,
      headers: { "set-cookie": "unsafe" },
    })).toEqual({ contentType: 'application/vnd.example+zip; title="a\\"b"', contentLength: 0, statusCode: 200 });
  });

  it.each([
    "text/plain\r\n; charset=utf-8", 'text/plain; title="hidden\nline"',
    "text/plain, text/html", "text/plain; charset=é", "text/plain\u007f", "text",
  ])("rejects unsafe or ambiguous MIME metadata: %j", (contentType) => {
    expect(() => parsePluginResourceMetadata({ contentType })).toThrow("content type");
  });

  it("derives exact partial-response lengths and validates unsatisfied ranges", () => {
    expect(parsePluginResourceMetadata({ contentType: "audio/wav", statusCode: 206, contentRange: "bytes 2-4/7", acceptRanges: "bytes" }))
      .toEqual({ contentType: "audio/wav", statusCode: 206, contentRange: "bytes 2-4/7", contentLength: 3, acceptRanges: "bytes" });
    expect(parsePluginResourceMetadata({ contentType: "audio/wav", statusCode: 416, contentRange: "bytes */7" }))
      .toMatchObject({ statusCode: 416, contentRange: "bytes */7" });
  });

  it.each([
    { statusCode: null }, { contentLength: "3" }, { contentLength: -1 },
    { statusCode: 206 }, { statusCode: 416 }, { contentRange: "bytes 0-2/3" },
    { statusCode: 206, contentRange: "bytes 2-1/3" },
    { statusCode: 206, contentRange: "bytes 0-3/3" },
    { statusCode: 206, contentRange: "bytes 0-2/3", contentLength: 2 },
    { statusCode: 206, contentRange: `bytes 0-${String(Number.MAX_SAFE_INTEGER)}/*` },
    { statusCode: 416, contentRange: "bytes 0-2/3" }, { acceptRanges: "none" },
  ])("rejects inconsistent status, length, or range metadata: %j", (invalid) => {
    expect(() => parsePluginResourceMetadata({ contentType: "application/octet-stream", ...invalid })).toThrow();
  });
});
