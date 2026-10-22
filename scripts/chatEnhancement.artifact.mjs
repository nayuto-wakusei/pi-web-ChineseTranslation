import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";

it("loads the self-contained highlighting artifact outside the checkout and keeps code escaped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-highlight-artifact-"));
  const browser = new Window({ url: "https://artifact.test/" });
  try {
    for (const name of ["window", "document", "customElements", "HTMLElement", "Element", "ShadowRoot", "Document", "CSSStyleSheet"]) {
      vi.stubGlobal(name, name === "window" ? browser : name === "document" ? browser.document : browser[name]);
    }
    const root = resolve("dist/pi-web-plugins/code-highlight");
    const files = (await readdir(root, { recursive: true })).map((path) => path.replaceAll("\\", "/"));
    expect(files.filter((path) => path.endsWith(".js"))).toEqual(["browser/pi-web-plugin.js"]);
    expect(files.some((path) => /\.(?:ts|map)$/u.test(path))).toBe(false);
    const isolated = join(directory, "plugin.mjs");
    await copyFile(join(root, "browser/pi-web-plugin.js"), isolated);
    const plugin = (await import(pathToFileURL(isolated).href)).default;
    const html = (strings, ...values) => ({ strings, values });
    const activation = plugin.activate({ html, translate: (_key, fallback) => fallback });
    activation.start({ capabilities: { resolve: (token) => token.id === "syntax-highlighting"
      ? { supports: () => false, highlight: () => Promise.resolve(undefined) }
      : { createController: () => undefined, registerRoot: () => () => undefined, subscribe: () => () => undefined } } });
    const renderer = activation.contributions.contentRenderers[0];
    expect(plugin.apiVersion).toBe(5);
    expect(renderer.supports({ machineId: "remote", language: "javascript" })).toBe(true);
    const output = renderer.render({ text: 'const example = "<script>alert(1)</script>";', machineId: "remote", language: "javascript", signal: new AbortController().signal, fail: () => undefined });
    const markup = output.values.find((value) => typeof value === "string" && value.includes("hljs-keyword"));
    expect(markup).toBeTypeOf("string");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  } finally {
    vi.unstubAllGlobals();
    await browser.happyDOM.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

it("publishes v5 renderer and grammar types without extending the legacy contribution shape", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-highlight-types-"));
  try {
    const declaration = resolve("dist/plugin-api.js").replaceAll("\\", "/");
    const consumer = join(directory, "consumer.mts");
    await writeFile(consumer, `import type { PluginContributions, PluginContributionsV5, ContentRendererContributionV5, SyntaxHighlighterContribution, SyntaxHighlightingCapability } from ${JSON.stringify(declaration)};
const grammar: SyntaxHighlighterContribution = { id: "test", languages: ["test"], highlight: () => [{ from: 0, to: 1, kind: "keyword" }] };
const renderer: ContentRendererContributionV5 = { id: "render", title: "Code", supports: request => request.machineId === "remote", render: input => { const machine: string | undefined = input.machineId; void machine; throw new Error("type-only consumer"); } };
const current: PluginContributionsV5 = { syntaxHighlighters: [grammar], contentRenderers: [renderer] };
const legacy: PluginContributions = {};
// @ts-expect-error Grammar contributions belong to v5, not the frozen legacy shape.
legacy.syntaxHighlighters = [grammar];
declare const capability: SyntaxHighlightingCapability;
void capability.highlight({ machineId: "remote", language: "test", text: "a", signal: new AbortController().signal });
void current;
`, "utf8");
    const program = ts.createProgram([consumer], { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    expect(ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const emitted = await readFile(resolve("dist/plugin-api.d.ts"), "utf8");
    expect(emitted).not.toMatch(/shared\/i18n|client\/src/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
