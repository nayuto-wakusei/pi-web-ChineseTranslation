import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parseTranslationMessages } from "./shared/i18n";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path)
      : entry.name.endsWith(".ts") && !/\.(?:test|testSupport)\.ts$/u.test(entry.name) ? [path] : [];
  });
}

describe("language catalog contracts", () => {
  it("keeps hardcoded Chinese out of owned display copy, including shared helpers", () => {
    // Model-facing tool contracts stay unchanged, even when the UI is English.
    const runtimeContracts = new Set([
      "src/server/sessions/spawnSessionTool.ts",
      "src/server/sessions/spawnSubsessionTool.ts",
      "src/server/workbench/workbenchTools.ts",
    ]);
    // These are compatibility checks and a developer log, not display defaults.
    const exceptions = new Map<string, readonly string[]>([
      ["src/client/src/controllers/sessionController.ts", ["未找到会话"]],
      ["src/server/sessions/sessionRoutes.ts", ["未找到会话", "未找到已归档会话"]],
      ["pi-web-plugins/updates/pi-web-plugin.ts", ['更新插件执行 "', '" 失败']],
    ]);
    const unexpected: string[] = [];
    for (const path of [...sourceFiles("src"), ...sourceFiles("pi-web-plugins")]) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.startsWith("pi-web-plugins/zh-cn/") || runtimeContracts.has(normalized)) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
          && /\p{Script=Han}/u.test(node.text) && exceptions.get(normalized)?.includes(node.text) !== true) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          unexpected.push(`${normalized}:${String(line)}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(unexpected).toEqual([]);
  });

  it("has matching Chinese entries and named parameters for every owned display message", () => {
    const catalogs = "pi-web-plugins/zh-cn";
    const messages: Record<string, string> = {};
    for (const name of readdirSync(catalogs).filter((name) => name.endsWith(".json") && name !== "package.json")) {
      const entries = parseTranslationMessages(JSON.parse(readFileSync(join(catalogs, name), "utf8")));
      for (const [key, value] of Object.entries(entries)) {
        expect(messages[key], `Duplicate translation key ${key} in ${name}`).toBeUndefined();
        messages[key] = value;
      }
    }
    const parameters = (value: string) => [...new Set([...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/gu)].map((match) => match[1]))].sort();
    let count = 0;
    for (const path of sourceFiles("src")) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const name = ts.isIdentifier(node.expression) ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
          if (["t", "translate", "UserFacingError", "WorkspaceUserError"].includes(name)) {
            const [key, fallback] = node.arguments ?? [];
            if (key !== undefined && fallback !== undefined && ts.isStringLiteral(key) && ts.isStringLiteralLike(fallback)) {
              count++;
              const translation = messages[key.text];
              expect(translation, `${path}: missing ${key.text}`).toBeTypeOf("string");
              expect(fallback.text, `${path}: English fallback ${key.text}`).not.toMatch(/\p{Script=Han}/u);
              expect(parameters(translation ?? ""), `${path}: parameters ${key.text}`).toEqual(parameters(fallback.text));
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(count).toBeGreaterThan(1000);
  });
});
