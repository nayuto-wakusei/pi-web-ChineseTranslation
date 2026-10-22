import { describe, expect, it } from "vitest";
import { parseVersionOptions } from "./cli.js";

describe("version arguments", () => {
  it("only enables remote release lookup explicitly", () => {
    expect(parseVersionOptions([])).toEqual({});
    expect(parseVersionOptions(["--check"])).toEqual({ check: true });
  });

  it.each([["--unknown"], ["--check", "extra"], ["--check", "--check"]])("rejects invalid arguments %j", (...args) => {
    expect(() => parseVersionOptions(args)).toThrow("Usage: pi-web version [--check]");
  });
});
