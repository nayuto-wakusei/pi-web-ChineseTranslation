import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

// Importing sessiond starts services; exercise reads through the integration
// fixture and inspect only the production dependency wiring here.
it("passes the configured management root to session reads even when disabled, without changing route enablement", async () => {
  const source = await readFile(new URL("../sessiond.ts", import.meta.url), "utf8");
  expect(source).toMatch(/const configuredManagementProjectRoot = config\.managementEmbed === undefined\s*\? undefined\s*: config\.managementEmbed\.projectRoot \?\? join\(homedir\(\), "PiWeb"\)/u);
  expect(source).toContain("managementProjectRoot: configuredManagementProjectRoot");
  expect(source).toMatch(/const managementProjectRoot = config\.managementEmbed\?\.enabled === true\s*\? configuredManagementProjectRoot\s*: undefined/u);
});

it("uses the existing pure project authority rather than credential initialization for read access", async () => {
  const source = await readFile(new URL("../sessiond.ts", import.meta.url), "utf8");
  const callback = /projectPathForCwd: async \(cwd\) => \{([\s\S]*?)\n {6}\},/u.exec(source)?.[1];
  expect(callback).toContain("projectAuth.projectForCwd(cwd)");
  expect(callback).not.toContain("projectAuth.forCwd");
  expect(callback).not.toContain("modelRuntime");
});
