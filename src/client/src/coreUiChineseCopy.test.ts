import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createTranslator, parseTranslationMessages } from "../../shared/i18n";
import { isRecord } from "../../shared/piWebConfigParsing";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const catalogs = ["components", "client", "bundled", "metadata"].map((name) =>
  parseTranslationMessages(JSON.parse(readFileSync(join(root, "pi-web-plugins/zh-cn", `${name}.json`), "utf8"))));
const messages: Record<string, string> = {};
for (const catalog of catalogs) Object.assign(messages, catalog);

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.name.endsWith(".ts") && !/\.(?:test|testSupport)\.ts$/u.test(entry.name) ? [path] : [];
  });
}

function translationCalls(path: string): { key: string; fallback: string }[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const calls: { key: string; fallback: string }[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "translate"].includes(node.expression.text)) {
      const [key, fallback] = node.arguments;
      if (key !== undefined && fallback !== undefined && ts.isStringLiteral(key) && ts.isStringLiteralLike(fallback)) {
        calls.push({ key: key.text, fallback: fallback.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

function readManifest(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(join(root, path), "utf8"));
  if (!isRecord(value)) throw new Error(`Invalid manifest: ${path}`);
  return value;
}

describe("Chinese language plugin display copy", () => {
  it("keeps catalog ownership unambiguous", () => {
    const keys = catalogs.flatMap((catalog) => Object.keys(catalog));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("provides Chinese translations for every migrated client and bundled-plugin call", () => {
    const calls = [
      ...productionFiles(join(root, "src/client/src")),
      ...productionFiles(join(root, "pi-web-plugins")),
    ].flatMap(translationCalls);
    expect(calls.length).toBeGreaterThan(100);
    const parameters = (text: string): string[] => [...new Set([...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/gu)].map((match) => match[1] ?? ""))].sort();
    for (const { key, fallback } of calls) {
      expect(messages[key], `Missing Chinese translation: ${key}`).toBeTypeOf("string");
      expect(fallback, `English fallback: ${key}`).not.toMatch(/\p{Script=Han}/u);
      expect(parameters(messages[key] ?? ""), `Parameters: ${key}`).toEqual(parameters(fallback));
      expect(createTranslator("en", messages)(key, fallback)).toBe(fallback);
      expect(createTranslator("zh-CN", messages)(key, fallback)).toBe(messages[key]);
    }
  });

  it("ships an English base document and a Chinese install manifest", () => {
    const html = readFileSync(join(root, "src/client/index.html"), "utf8");
    const english = readManifest("src/client/public/manifest.webmanifest");
    const chinese = readManifest("pi-web-plugins/zh-cn/manifest.webmanifest");
    expect(html).toContain('lang="en"');
    expect(english["lang"]).toBe("en");
    expect(english["description"]).not.toMatch(/\p{Script=Han}/u);
    expect(chinese["lang"]).toBe("zh-CN");
    expect(chinese["start_url"]).toBe("../../");
    expect(chinese["description"]).toBe(messages["app.description"]);
  });
});
