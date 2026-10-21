import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../../pi-web-plugins/zh-cn/projects.json";
import { createTranslator, UserFacingError, userFacingErrorMessage } from "../shared/i18n.js";
import { canonicalizeStoredCwd, cwdPathsEqual, normalizeRequestCwd } from "./workingDirectory.js";

// resolve() so the base already carries a drive letter on Windows, matching
// what normalizeRequestCwd/canonicalizeStoredCwd produce.
const absoluteBase = resolve(sep, "srv", "projects", "demo");

describe("normalizeRequestCwd", () => {
  it.each([
    ["en", undefined, "cwd is required"],
    ["zh-CN", undefined, "必须提供 cwd"],
    ["en", "relative", "cwd must be an absolute path"],
    ["zh-CN", "relative", "cwd 必须是绝对路径"],
  ])("exposes tagged validation copy for %s without localizing path values", (locale, input, message) => {
    let error: unknown;
    try { normalizeRequestCwd(input); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(UserFacingError);
    expect(userFacingErrorMessage(error, createTranslator(locale, messages))).toBe(message);
  });

  it("returns absolute paths in canonical form", () => {
    expect(normalizeRequestCwd(absoluteBase)).toBe(absoluteBase);
    expect(normalizeRequestCwd(`${absoluteBase}${sep}`)).toBe(absoluteBase);
    expect(normalizeRequestCwd(join(absoluteBase, ".", "nested", ".."))).toBe(absoluteBase);
  });

  it.skipIf(process.platform !== "win32")("treats Windows backslash and forward-slash paths as equal", () => {
    expect(normalizeRequestCwd("C:/Users/dev/project")).toBe("C:\\Users\\dev\\project");
  });

  it("rejects missing, empty, and non-string values", () => {
    expect(() => normalizeRequestCwd(undefined)).toThrow("cwd is required");
    expect(() => normalizeRequestCwd("")).toThrow("cwd is required");
    expect(() => normalizeRequestCwd(42)).toThrow("cwd is required");
  });

  it("rejects relative paths instead of resolving them against the process cwd", () => {
    expect(() => normalizeRequestCwd("relative/path")).toThrow("cwd must be an absolute path");
    expect(() => normalizeRequestCwd(".")).toThrow("cwd must be an absolute path");
  });
});

describe("canonicalizeStoredCwd", () => {
  it("canonicalizes absolute paths", () => {
    expect(canonicalizeStoredCwd(`${absoluteBase}${sep}`)).toBe(absoluteBase);
  });

  it("preserves legacy empty and relative values instead of resolving against the process cwd", () => {
    expect(canonicalizeStoredCwd("")).toBe("");
    expect(canonicalizeStoredCwd("relative/path")).toBe("relative/path");
  });
});

describe("cwdPathsEqual", () => {
  it("matches paths that differ only by normalization", () => {
    expect(cwdPathsEqual(absoluteBase, `${absoluteBase}${sep}`)).toBe(true);
    expect(cwdPathsEqual(absoluteBase, join(absoluteBase, "."))).toBe(true);
  });

  it.skipIf(process.platform !== "win32")("treats Windows backslash and forward-slash paths as equal", () => {
    expect(cwdPathsEqual("C:\\Users\\dev\\project", "C:/Users/dev/project")).toBe(true);
  });

  it("distinguishes different paths", () => {
    expect(cwdPathsEqual(join(absoluteBase, "a"), join(absoluteBase, "b"))).toBe(false);
  });
});
