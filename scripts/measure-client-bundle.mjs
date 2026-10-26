import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve("dist/client/assets");
const output = resolve(process.argv[2] ?? "node_modules/.cache/pi-web/performance/client-bundle.json");
const label = process.argv[3] ?? "working-tree";
const names = await readdir(root);
const entries = names.filter((name) => /^(?:index|PiWebApp)-.+\.js$/u.test(name));
if (entries.length !== 2) throw new Error(`Expected client entry and PiWebApp boot module, found ${entries.join(", ")}`);
const pending = entries.map((name) => resolve(root, name));
const visited = new Set();
const assets = [];
while (pending.length > 0) {
  const path = pending.pop();
  if (visited.has(path)) continue;
  visited.add(path);
  const source = await readFile(path, "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const node of parsed.statements) {
    if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    if (node.moduleSpecifier.text.startsWith(".")) pending.push(resolve(dirname(path), node.moduleSpecifier.text));
  }
  assets.push({ name: basename(path), bytes: (await stat(path)).size });
}
assets.sort((left, right) => left.name.localeCompare(right.name));
const result = { label, measuredAt: new Date().toISOString(), definition: "index + PiWebApp boot module and recursive static JavaScript imports; excludes later dynamic imports", assets, totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0) };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
