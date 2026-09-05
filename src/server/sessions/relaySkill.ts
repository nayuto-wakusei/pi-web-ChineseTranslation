import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { withFileMutationQueue, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";

export const MANAGED_RELAY_SKILL_DIRECTORY = join(".pi", "skills", "relay");
const BUNDLED_RELAY_SKILL_PATH = fileURLToPath(new URL("../../../skills/relay/SKILL.md", import.meta.url));
const PACKAGED_RELAY_SKILL_PATH = fileURLToPath(new URL("../../../dist/pi-packages/relays/skills/relay/SKILL.md", import.meta.url));

function normalizedSkill(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export async function ensureManagedRelaySkill(cwd: string, bundledSkillPath = BUNDLED_RELAY_SKILL_PATH): Promise<string> {
  const projectRoot = realpathSync(cwd);
  const piDirectory = join(projectRoot, ".pi");
  const skillsDirectory = join(piDirectory, "skills");
  const skillDirectory = join(skillsDirectory, "relay");
  for (const directory of [piDirectory, skillsDirectory, skillDirectory]) {
    try {
      await mkdir(directory);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    assertManagedSkillPath(projectRoot, directory, "directory");
  }
  const skillPath = join(skillDirectory, "SKILL.md");
  return withFileMutationQueue(skillPath, async () => {
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
export function deduplicateBundledRelaySkill(cwd: string, base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }): typeof base {
  return {
    ...base,
    diagnostics: base.diagnostics.filter((diagnostic) => {
      const collision = diagnostic.collision;
      if (diagnostic.type !== "collision" || collision?.resourceType !== "skill" || collision.name !== "relay") return true;
      try {
        const projectRoot = realpathSync(cwd);
        const projectSkill = join(projectRoot, MANAGED_RELAY_SKILL_DIRECTORY, "SKILL.md");
        assertManagedSkillPath(projectRoot, projectSkill, "file");
        const projectRealPath = realpathSync(projectSkill);
        const winner = realpathSync(collision.winnerPath);
        const loser = realpathSync(collision.loserPath);
        const otherPath = winner === projectRealPath ? loser : loser === projectRealPath ? winner : undefined;
        if (otherPath === undefined || !isBundledRelayPath(otherPath)) return true;
        return normalizedSkill(readFileSync(projectSkill, "utf8")) !== normalizedSkill(readFileSync(otherPath, "utf8"));
      } catch {
        // Missing or unreadable resources must retain their diagnostics.
        return true;
      }
    }),
  };
}

function isBundledRelayPath(path: string): boolean {
  return [BUNDLED_RELAY_SKILL_PATH, PACKAGED_RELAY_SKILL_PATH].some((candidate) => {
    try {
      return realpathSync(candidate) === path;
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
