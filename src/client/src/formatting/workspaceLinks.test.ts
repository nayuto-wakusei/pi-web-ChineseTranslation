// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { toSafeMarkdownHtml } from "./markdown";
import { workspaceMarkdownFilePath, type MarkdownWorkspaceContext } from "./workspaceLinks";

const workspace: MarkdownWorkspaceContext = {
  machineId: "local",
  projectId: "project",
  workspaceId: "workspace",
  root: "/tmp/project",
};

describe("workspace markdown links", () => {
  it("classifies workspace-relative paths and rejects external or escaping references", () => {
    expect(workspaceMarkdownFilePath("docs/readme.md", workspace)).toBe("docs/readme.md");
    expect(workspaceMarkdownFilePath("/tmp/project/src/app.ts?line=3", workspace)).toBe("src/app.ts");
    expect(workspaceMarkdownFilePath("./nested/./file.txt#section", workspace)).toBe("nested/file.txt");
    expect(workspaceMarkdownFilePath("https://example.test/file.md", workspace)).toBeUndefined();
    expect(workspaceMarkdownFilePath("/other/project/file.md", workspace)).toBeUndefined();
    expect(workspaceMarkdownFilePath("docs\\windows.md", workspace)).toBeUndefined();
    expect(workspaceMarkdownFilePath("#heading", workspace)).toBeUndefined();
  });

  it("rewrites workspace file links and keeps the Chinese table label", () => {
    const html = toSafeMarkdownHtml("[说明](docs/readme.md)\n\n| 列 |\n| --- |\n| 值 |", workspace);
    const root = document.createElement("template");
    root.innerHTML = html;
    const link = root.content.querySelector("a");
    expect(link?.getAttribute("data-workspace-file")).toBe("docs/readme.md");
    expect(link?.getAttribute("href")).toContain("file/preview");
    expect(link?.getAttribute("target")).toBe("_self");
    expect(root.content.querySelector("[aria-label='表格']")).not.toBeNull();
    expect(toSafeMarkdownHtml("[外部](https://example.test)").includes("data-workspace-file")).toBe(false);
  });
});

describe("workspace Markdown path normalization", () => {
  it.each([".", "./", "././", "/work/./", "%2E/%2E"])("does not classify workspace-root reference %s as a file", (href) => {
    expect(workspaceMarkdownFilePath(href, { ...workspace, root: "/work" })).toBeUndefined();
  });

  it.each(["../secret", "./dir/../secret", "dir/%2E%2E/secret", "/work/dir/../secret"])("preserves traversal in %s for server rejection", (href) => {
    expect(workspaceMarkdownFilePath(href, { ...workspace, root: "/work" })?.split("/")).toContain("..");
  });

  it.each(["https://example.com/./file", "//example.com/./file", "mailto:a@example.com", "javascript:alert(1)", "#section", "?query", "/elsewhere/./file", "/work-other/file", "bad%ZZ", "dir%5Cfile", "file%00.txt"])("does not normalize excluded reference %s into a workspace file", (href) => {
    expect(workspaceMarkdownFilePath(href, { ...workspace, root: "/work" })).toBeUndefined();
  });

  it("decodes only once and preserves meaningful filename characters", () => {
    expect(workspaceMarkdownFilePath("./.hidden//%252E%252E/a%20%23%3F%25.txt", { ...workspace, root: "/work" })).toBe(".hidden/%2E%2E/a #?%.txt");
  });
});
