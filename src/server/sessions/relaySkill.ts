import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileMutationQueue, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";

export const MANAGED_RELAY_SKILL_NAMES = ["relay", "relay-runner"] as const;
const BUNDLED_SKILLS_DIRECTORY = fileURLToPath(new URL("../../../skills/", import.meta.url));
const PACKAGED_SKILLS_DIRECTORY = fileURLToPath(new URL("../../../dist/pi-packages/relays/skills/", import.meta.url));

function normalizedSkill(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export async function ensureManagedRelaySkills(cwd: string, bundledSkillsDirectory = BUNDLED_SKILLS_DIRECTORY): Promise<string[]> {
  const paths: string[] = [];
  for (const name of MANAGED_RELAY_SKILL_NAMES) {
    paths.push(await synchronizeManagedSkill(cwd, name, join(bundledSkillsDirectory, name, "SKILL.md")));
  }
  return paths;
}

async function synchronizeManagedSkill(cwd: string, name: string, bundledSkillPath: string): Promise<string> {
  const projectRoot = realpathSync(cwd);
  const piDirectory = join(projectRoot, ".pi");
  const skillsDirectory = join(piDirectory, "skills");
  const skillDirectory = join(skillsDirectory, name);
  for (const directory of [piDirectory, skillsDirectory, skillDirectory]) {
    try {
      await mkdir(directory);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    assertManagedSkillPath(projectRoot, directory, "directory");
  }
  const skillPath = join(skillDirectory, "SKILL.md");
  // Queue registration realpaths its key; use the stable directory so Windows
  // does not open the destination file while another start is replacing it.
  return withFileMutationQueue(skillDirectory, async () => {
    try {
      assertManagedSkillPath(projectRoot, skillPath, "file");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    const current = await readFile(bundledSkillPath, "utf8");
    try {
      if (await readFile(skillPath, "utf8") === current) return skillPath;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    // Concurrent session starts must never read a partially overwritten template.
    const temporaryPath = join(skillDirectory, `.relay-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, current, { flag: "wx" });
      await rename(temporaryPath, skillPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return skillPath;
  });
}

/** The SDK already selects one skill; omit only a proven identical bundled/project duplicate. */
export function deduplicateBundledRelaySkills(cwd: string, base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }): typeof base {
  return {
    ...base,
    diagnostics: base.diagnostics.filter((diagnostic) => {
      const collision = diagnostic.collision;
      if (diagnostic.type !== "collision" || collision?.resourceType !== "skill") return true;
      const name = MANAGED_RELAY_SKILL_NAMES.find((name) => name === collision.name);
      if (name === undefined) return true;
      try {
        const projectRoot = realpathSync(cwd);
        const projectSkill = join(projectRoot, ".pi", "skills", name, "SKILL.md");
        assertManagedSkillPath(projectRoot, projectSkill, "file");
        const projectRealPath = realpathSync(projectSkill);
        const winner = realpathSync(collision.winnerPath);
        const loser = realpathSync(collision.loserPath);
        const otherPath = winner === projectRealPath ? loser : loser === projectRealPath ? winner : undefined;
        if (otherPath === undefined || !isBundledRelayPath(otherPath, name)) return true;
        return normalizedSkill(readFileSync(projectSkill, "utf8")) !== normalizedSkill(readFileSync(otherPath, "utf8"));
      } catch {
        // Missing or unreadable resources must retain their diagnostics.
        return true;
      }
    }),
  };
}

function isBundledRelayPath(path: string, name: string): boolean {
  return [BUNDLED_SKILLS_DIRECTORY, PACKAGED_SKILLS_DIRECTORY].some((directory) => {
    try {
      return realpathSync(join(directory, name, "SKILL.md")) === path;
    } catch {
      return false;
    }
  });
}

function assertManagedSkillPath(projectRoot: string, path: string, expectedType: "directory" | "file"): void {
  const realPath = realpathSync(path);
  const childRelativePath = relative(projectRoot, realPath);
  const stats = statSync(realPath);
  const hasExpectedType = expectedType === "directory" ? stats.isDirectory() : stats.isFile();
  if (childRelativePath.startsWith("..") || isAbsolute(childRelativePath) || !hasExpectedType) {
    throw new Error(`Managed skill path is invalid: ${path}`);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
