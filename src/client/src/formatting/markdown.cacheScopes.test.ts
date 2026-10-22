// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { marked } from "marked";
import { toSafeMarkdownHtml } from "./markdown";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

it("reuses context-free HTML across deployment bases and management entry changes", () => {
  vi.stubEnv("BASE_URL", "./");
  window.history.replaceState(null, "", "/first/?view=chat");
  const text = "Context-free cache scope regression: **retained**.";
  const first = toSafeMarkdownHtml(text);
  const parse = vi.spyOn(marked, "parse");
  window.history.replaceState(null, "", "/second/?embed=management&token=first-entry");
  expect(toSafeMarkdownHtml(text)).toBe(first);
  window.history.replaceState(null, "", "/third/?embed=management&token=second-entry");
  vi.stubEnv("BASE_URL", "/fixed/");
  expect(toSafeMarkdownHtml(text)).toBe(first);
  expect(parse).not.toHaveBeenCalled();
});

it("keeps workspace previews isolated across effective bases and management entries", () => {
  vi.stubEnv("BASE_URL", "./");
  const context = { machineId: "remote", projectId: "project", workspaceId: "workspace", root: "/work" };
  const text = "![Workspace cache scope regression](image.png)";
  const preview = () => {
    const root = document.createElement("div");
    root.innerHTML = toSafeMarkdownHtml(text, context, "session:part");
    const source = root.querySelector("pi-web-markdown-image")?.getAttribute("preview-url");
    if (source === undefined || source === null) throw new Error("Missing workspace image URL");
    return new URL(source);
  };
  window.history.replaceState(null, "", "/first/");
  expect(preview().pathname).toContain("/first/api/machines/remote/");
  window.history.replaceState(null, "", "/second/?embed=management&token=first-entry");
  expect(preview().pathname).toContain("/second/api/machines/remote/");
  expect(preview().searchParams.get("token")).toBe("first-entry");
  window.history.replaceState(null, "", "/second/?embed=management&token=second-entry");
  expect(preview().searchParams.get("token")).toBe("second-entry");
  window.history.replaceState(null, "", "/second/");
  expect(preview().searchParams.has("embed")).toBe(false);
  expect(preview().searchParams.has("token")).toBe(false);
});
