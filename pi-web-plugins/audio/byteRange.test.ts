import { describe, expect, it } from "vitest";
import { parseByteRange } from "./byteRange.js";

describe("single byte ranges", () => {
  it.each([
    ["bytes=0-0", { start: 0, end: 0 }],
    ["bytes=3-", { start: 3, end: 9 }],
    ["bytes=3-99", { start: 3, end: 9 }],
    ["bytes=-3", { start: 7, end: 9 }],
    ["bytes=-99", { start: 0, end: 9 }],
    ["bytes=9-9", { start: 9, end: 9 }],
  ])("parses %s", (header, expected) => { expect(parseByteRange(header, 10)).toEqual(expected); });

  it.each(["", "bytes=-", "bytes=-0", "bytes=10-", "bytes=4-3", "bytes=1-2,4-5", "items=0-1", "bytes=1.5-2", "bytes=+1-2", "bytes=9007199254740992-", "bytes=-9007199254740992", "bytes=0-9007199254740992", "bytes=0-1\n"])("rejects %s", (header) => { expect(parseByteRange(header, 10)).toBeUndefined(); });

  it("rejects empty and unsafe file sizes", () => {
    for (const size of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(parseByteRange("bytes=0-", size)).toBeUndefined();
    expect(parseByteRange("bytes=9007199254740990-", Number.MAX_SAFE_INTEGER)).toEqual({ start: 9007199254740990, end: 9007199254740990 });
  });
});
