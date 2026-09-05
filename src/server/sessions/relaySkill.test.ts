import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager, type ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { deduplicateBundledRelaySkill, ensureManagedRelaySkill } from "./relaySkill.js";

const bundledSkill = fileURLToPath(new URL("../../../skills/relay/SKILL.md", import.meta.url));
const relayPackage = fileURLToPath(new URL("../../../pi-packages/relays", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-web-relay-sync-"));
  roots.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  return { root, cwd, agentDir, projectSkill: join(cwd, ".pi", "skills", "relay", "SKILL.md") };
}

function collision(winnerPath: string, loserPath: string): ResourceDiagnostic {
  return {
    type: "collision",
    message: 'name "relay" collision',
    path: loserPath,
    collision: { resourceType: "skill", name: "relay", winnerPath, loserPath },
  };
}

describe("Relay skill synchronization", () => {
  it("does not create a project skill in normal mode", async () => {
    const { cwd, projectSkill } = await fixture();
    deduplicateBundledRelaySkill(cwd, { skills: [], diagnostics: [] });
    await expect(readFile(projectSkill)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("forces current content into an existing project copy, including user edits", async () => {
    const { cwd, projectSkill } = await fixture();
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, "old or customized relay");
    await ensureManagedRelaySkill(cwd);
    expect(await readFile(projectSkill, "utf8")).toBe(await readFile(bundledSkill, "utf8"));
    await writeFile(projectSkill, "edited again");
    await ensureManagedRelaySkill(cwd);
    expect(await readFile(projectSkill, "utf8")).toBe(await readFile(bundledSkill, "utf8"));
  });

  it("does not overwrite a skill reached through a workspace-escaping junction", async () => {
    const { root, cwd } = await fixture();
    const outside = join(root, "outside");
    const outsideSkill = join(outside, "skills", "relay", "SKILL.md");
    await mkdir(dirname(outsideSkill), { recursive: true });
    await writeFile(outsideSkill, "outside relay");
    await symlink(outside, join(cwd, ".pi"), "junction");
    await expect(ensureManagedRelaySkill(cwd)).rejects.toThrow("Managed skill path is invalid");
    expect(await readFile(outsideSkill, "utf8")).toBe("outside relay");
  });

  it("leaves complete current content after concurrent management starts", async () => {
    const { cwd, projectSkill } = await fixture();
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, "outdated relay");
    const current = await readFile(bundledSkill, "utf8");
    await Promise.all(Array.from({ length: 4 }, async () => {
      await ensureManagedRelaySkill(cwd);
      expect(await readFile(projectSkill, "utf8")).toBe(current);
    }));
    expect(await readdir(dirname(projectSkill))).toEqual(["SKILL.md"]);
  });

  it("loads the refreshed project skill and the real Relay package without a redundant warning", async () => {
    const { cwd, agentDir, projectSkill } = await fixture();
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, '---\nname: relay\ndescription: Old Relay method\n---\nOld content\n');
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory({ packages: [relayPackage] }),
      noExtensions: true,
      noContextFiles: true,
      noThemes: true,
      noPromptTemplates: true,
      skillsOverride: (base) => deduplicateBundledRelaySkill(cwd, base),
    });
    await loader.reload();
    expect(loader.getSkills().diagnostics).toContainEqual(expect.objectContaining({ type: "collision" }));
    expect(await readFile(projectSkill, "utf8")).toContain("Old content");

    await ensureManagedRelaySkill(cwd);
    await loader.reload();
    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(loader.getSkills().skills.filter((skill) => skill.name === "relay").map((skill) => skill.filePath)).toEqual([projectSkill]);
    expect(await readFile(projectSkill, "utf8")).toBe(await readFile(bundledSkill, "utf8"));

    await rm(projectSkill);
    await loader.reload();
    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(loader.getSkills().skills.filter((skill) => skill.name === "relay")).toHaveLength(1);
  });
});

describe("bundled Relay duplicate diagnostics", () => {
  it("removes only identical bundled/project collisions, including CRLF copies", async () => {
    const { cwd, projectSkill } = await fixture();
    await ensureManagedRelaySkill(cwd);
    await writeFile(projectSkill, (await readFile(bundledSkill, "utf8")).replace(/\r?\n/g, "\r\n"));
    const warning: ResourceDiagnostic = { type: "warning", path: projectSkill, message: "preserve this warning" };
    expect(deduplicateBundledRelaySkill(cwd, {
      skills: [],
      diagnostics: [collision(projectSkill, bundledSkill), collision(bundledSkill, projectSkill), warning],
    }).diagnostics).toEqual([warning]);
  });

  it("preserves collisions with third-party skills even when their content matches", async () => {
    const { root, cwd, projectSkill } = await fixture();
    await ensureManagedRelaySkill(cwd);
    const other = join(root, "other-relay.md");
    await writeFile(other, await readFile(bundledSkill));
    const diagnostic = collision(projectSkill, other);
    expect(deduplicateBundledRelaySkill(cwd, { skills: [], diagnostics: [diagnostic] }).diagnostics).toEqual([diagnostic]);
  });

  it("retains stale diagnostics when a referenced file no longer exists", async () => {
    const { cwd, projectSkill } = await fixture();
    const diagnostic = collision(projectSkill, bundledSkill);
    expect(deduplicateBundledRelaySkill(cwd, { skills: [], diagnostics: [diagnostic] }).diagnostics).toEqual([diagnostic]);
  });
});
