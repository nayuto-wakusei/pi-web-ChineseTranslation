import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoots = ["pi-web-plugins", "pi-packages"];
const forbiddenPatterns = [
  { pattern: /\bfetch\s*\(/u, message: "direct browser fetch" },
  { pattern: /["'`][^"'`]*\/api\//u, message: "direct PI WEB /api URL" },
  { pattern: /piWebInternal/u, message: "legacy internal plugin context" },
  { pattern: /(?:\.\.\/)+src\//u, message: "imports from PI WEB source internals" },
];

describe("PI WEB plugin packages", () => {
  it("use public plugin APIs instead of direct PI WEB internals", async () => {
    const violations: string[] = [];
    for (const root of pluginRoots) {
      for (const file of await pluginSourceFiles(root)) {
        const content = await readFile(file, "utf8");
        for (const { pattern, message } of forbiddenPatterns) {
          if (pattern.test(content)) violations.push(`${file}: ${message}`);
        }
        if (content.includes("piWebUnstable") && !content.includes("@chainingintention/pi-web-cn/plugin-api/unstable")) {
          violations.push(`${file}: piWebUnstable use without explicit unstable type import`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function pluginSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await pluginSourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}
