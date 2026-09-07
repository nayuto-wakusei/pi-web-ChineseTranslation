import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filterManagedGlobalContextFiles, filterManagedProjectSkills, filterManagedWorkbenchSkills } from "./piSessionService.js";
import { ensureManagedRelaySkills } from "./relaySkill.js";

describe("filterManagedGlobalContextFiles", () => {
  it("removes global agent context files while keeping project context files", () => {
    const cwd = resolve("/home/user/PiWeb/project");
    const agentDir = resolve("/home/user/.pi/agent");
    const homeAgents = resolve("/home/user/AGENTS.md");
    const managedRootAgents = resolve("/home/user/PiWeb/AGENTS.md");
    const projectAgents = join(cwd, "AGENTS.md");
    const nestedAgents = join(cwd, "subdir/AGENTS.md");
    const unrelatedAgentFile = join(agentDir, "notes.md");

    const result = filterManagedGlobalContextFiles(cwd, agentDir, {
      agentsFiles: [
        { path: join(agentDir, "AGENTS.md"), content: "global agents" },
        { path: join(agentDir, "AGENTS.MD"), content: "global uppercase agents" },
        { path: join(agentDir, "CLAUDE.md"), content: "global claude" },
        { path: join(agentDir, "CLAUDE.MD"), content: "global uppercase claude" },
        { path: homeAgents, content: "home agents" },
        { path: managedRootAgents, content: "managed root agents" },
        { path: projectAgents, content: "project agents" },
        { path: nestedAgents, content: "nested agents" },
        { path: unrelatedAgentFile, content: "not context" },
      ],
    });

    expect(result.agentsFiles).toEqual([
      { path: projectAgents, content: "project agents" },
      { path: nestedAgents, content: "nested agents" },
      { path: unrelatedAgentFile, content: "not context" },
    ]);
  });
});

describe("filterManagedProjectSkills", () => {
  it("keeps project skills while removing global and package skills outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-skills-"));
    const cwd = join(root, "project");
    const projectSkillPath = join(cwd, ".pi/skills/project-skill/SKILL.md");
    const projectPackageSkillPath = join(cwd, ".pi/npm/node_modules/project-package/skills/package-skill/SKILL.md");
    const globalSkillPath = join(root, "agent/skills/global-skill/SKILL.md");
    const globalPackageSkillPath = join(root, "agent/npm/node_modules/global-package/skills/package-skill/SKILL.md");

    try {
      await Promise.all([projectSkillPath, projectPackageSkillPath, globalSkillPath, globalPackageSkillPath].map(async (filePath) => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, "skill");
      }));
      const projectSkill = testSkill("project-skill", projectSkillPath, "project");
      const projectPackageSkill = testSkill("project-package-skill", projectPackageSkillPath, "temporary");
      const globalSkill = testSkill("global-skill", globalSkillPath, "user");
      const globalPackageSkill = testSkill("global-package-skill", globalPackageSkillPath, "user");

      const result = filterManagedProjectSkills(cwd, {
        skills: [globalSkill, projectSkill, globalPackageSkill, projectPackageSkill],
        diagnostics: [
          { type: "warning", message: "preserved diagnostic" },
          { type: "warning", message: "project diagnostic", path: projectSkillPath },
          {
            type: "collision",
            message: 'name "project-skill" collision',
            path: globalSkillPath,
            collision: {
              resourceType: "skill",
              name: "project-skill",
              winnerPath: projectSkillPath,
              loserPath: globalSkillPath,
            },
          },
        ],
      });

      expect(result).toEqual({
        skills: [projectSkill, projectPackageSkill],
        diagnostics: [
          { type: "warning", message: "preserved diagnostic" },
          { type: "warning", message: "project diagnostic", path: projectSkillPath },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ensureManagedRelaySkills", () => {
  it("adds both bundled Relay skills when the project does not have them", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-relay-"));
    const cwd = join(root, "project");
    const bundledSkillsDirectory = join(root, "bundled-skills");

    try {
      await mkdir(cwd);
      for (const name of ["relay", "relay-runner"]) {
        await mkdir(join(bundledSkillsDirectory, name), { recursive: true });
        await writeFile(join(bundledSkillsDirectory, name, "SKILL.md"), `bundled ${name}`);
      }

      const skillPaths = await ensureManagedRelaySkills(cwd, bundledSkillsDirectory);

      expect(skillPaths).toEqual(["relay", "relay-runner"].map((name) => join(cwd, ".pi", "skills", name, "SKILL.md")));
      for (const name of ["relay", "relay-runner"]) {
        await expect(readFile(join(cwd, ".pi", "skills", name, "SKILL.md"), "utf8")).resolves.toBe(`bundled ${name}`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replaces an existing project relay skill with the current bundled version", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-relay-"));
    const cwd = join(root, "project");
    const bundledSkillPath = join(root, "bundled-skills", "relay", "SKILL.md");
    const bundledRunnerPath = join(root, "bundled-skills", "relay-runner", "SKILL.md");
    const projectSkillPath = join(cwd, ".pi", "skills", "relay", "SKILL.md");

    try {
      await Promise.all([dirname(projectSkillPath), dirname(bundledSkillPath), dirname(bundledRunnerPath)].map((directory) => mkdir(directory, { recursive: true })));
      await Promise.all([
        writeFile(projectSkillPath, "project relay"),
        writeFile(bundledSkillPath, "bundled relay"),
        writeFile(bundledRunnerPath, "bundled runner"),
      ]);

      await ensureManagedRelaySkills(cwd, join(root, "bundled-skills"));

      await expect(readFile(projectSkillPath, "utf8")).resolves.toBe("bundled relay");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a project skill directory that escapes through a junction", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-relay-"));
    const cwd = join(root, "project");
    const outside = join(root, "outside");
    const bundledSkillPath = join(root, "bundled-relay", "SKILL.md");

    try {
      await Promise.all([cwd, outside, dirname(bundledSkillPath)].map((directory) => mkdir(directory, { recursive: true })));
      await Promise.all([
        symlink(outside, join(cwd, ".pi"), "junction"),
        writeFile(bundledSkillPath, "bundled relay"),
      ]);

      await expect(ensureManagedRelaySkills(cwd)).rejects.toThrow("Managed skill path is invalid");
      await expect(readFile(join(outside, "skills", "relay", "SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("filterManagedWorkbenchSkills", () => {
  it("keeps both project Relay skills alongside Workbench-authorized skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-managed-workbench-skills-"));
    const cwd = join(root, "project");
    const relayPath = join(cwd, ".pi", "skills", "relay", "SKILL.md");
    const runnerPath = join(cwd, ".pi", "skills", "relay-runner", "SKILL.md");
    const authorizedPath = join(cwd, ".pi", "skills", "workbench-approved", "SKILL.md");
    const otherPath = join(cwd, ".pi", "skills", "other", "SKILL.md");

    try {
      await Promise.all([relayPath, runnerPath, authorizedPath, otherPath].map(async (filePath) => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, "skill");
      }));
      const relay = testSkill("relay", relayPath, "project");
      const runner = testSkill("relay-runner", runnerPath, "project");
      const authorized = testSkill("approved", authorizedPath, "project");
      const other = testSkill("other", otherPath, "project");

      const result = filterManagedWorkbenchSkills(cwd, {
        skills: [relay, runner, authorized, other],
        diagnostics: [
          {
            type: "collision",
            message: 'name "relay" collision',
            path: otherPath,
            collision: { resourceType: "skill", name: "relay", winnerPath: relayPath, loserPath: otherPath },
          },
        ],
      }, {
        authorizationRevision: 1,
        skills: [{ name: "approved", version: "1", directory: "workbench-approved", contentSha256: "hash", files: [], degradedCapabilities: [] }],
      });

      expect(result.skills).toEqual([relay, runner, authorized]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function testSkill(name: string, filePath: string, scope: "user" | "project" | "temporary") {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: dirname(filePath),
    sourceInfo: { path: filePath, source: "test", scope, origin: "top-level" as const },
    disableModelInvocation: false,
  };
}
