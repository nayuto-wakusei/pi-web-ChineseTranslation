import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skillNames = ["relay", "relay-runner"] as const;

/**
 * Guards the shipped layout of the Relay Pi package resources: Pi loads
 * `prompts/` and `skills/` from installed packages by convention, so a renamed
 * or malformed file would silently drop the feature.
 */
describe("Relay Pi package resources", () => {

  it.each(skillNames)("ships the %s skill with matching name and description frontmatter", async (name) => {
    const content = await readFile(join(__dirname, "skills", name, "SKILL.md"), "utf8");
    const frontmatter = frontmatterOf(content);

    expect(frontmatter).toContain(`name: ${name}`);
    expect(frontmatter).toContain("description:");
  });

  it.each(skillNames)("keeps the shipped %s skill identical to its canonical skill", async (name) => {
    const canonical = await readFile(join(__dirname, "..", "..", "skills", name, "SKILL.md"), "utf8");
    const shipped = await readFile(join(__dirname, "skills", name, "SKILL.md"), "utf8");

    expect(shipped).toBe(canonical);
  });

  it.each(skillNames)("includes the %s management template in the npm package allowlist", async (name) => {
    const manifest: unknown = JSON.parse(await readFile(join(__dirname, "..", "..", "package.json"), "utf8"));
    if (typeof manifest !== "object" || manifest === null || !("files" in manifest)) throw new Error("Missing package files allowlist");
    expect(manifest.files).toContain(`skills/${name}/SKILL.md`);
  });
});

function frontmatterOf(content: string): string {
  return /^---\n(?<frontmatter>[\s\S]*?)\n---/u.exec(content)?.groups?.["frontmatter"] ?? "";
}
