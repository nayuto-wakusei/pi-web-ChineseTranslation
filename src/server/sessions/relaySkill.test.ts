import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager, withFileMutationQueue, type ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deduplicateBundledRelaySkills, ensureManagedRelaySkills } from "./relaySkill.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original, withFileMutationQueue: vi.fn(original.withFileMutationQueue) };
});

const skillNames = ["relay", "relay-runner"] as const;
const relayPackage = fileURLToPath(new URL("../../../pi-packages/relays", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-relay-sync-"));
  roots.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  return {
    root, cwd, agentDir, projectSkill: join(cwd, ".pi", "skills", name, "SKILL.md"),
    bundledSkill: fileURLToPath(new URL(`../../../skills/${name}/SKILL.md`, import.meta.url)),
  };
}

function collision(name: string, winnerPath: string, loserPath: string): ResourceDiagnostic {
  return {
    type: "collision",
    message: `name "${name}" collision`,
    path: loserPath,
    collision: { resourceType: "skill", name, winnerPath, loserPath },
  };
}

describe.each(skillNames)("%s skill synchronization", (name) => {
  it("does not create a project skill in normal mode", async () => {
    const { cwd, projectSkill } = await fixture(name);
    deduplicateBundledRelaySkills(cwd, { skills: [], diagnostics: [] });
    await expect(readFile(projectSkill)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("forces current content into an existing project copy, including user edits", async () => {
    const { cwd, projectSkill, bundledSkill } = await fixture(name);
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, "old or customized relay");
    await ensureManagedRelaySkills(cwd);
    expect(await readFile(projectSkill, "utf8")).toBe(await readFile(bundledSkill, "utf8"));
    await writeFile(projectSkill, "edited again");
    await ensureManagedRelaySkills(cwd);
    expect(await readFile(projectSkill, "utf8")).toBe(await readFile(bundledSkill, "utf8"));
  });

  it("does not overwrite a skill reached through a workspace-escaping junction", async () => {
    const { root, cwd, projectSkill } = await fixture(name);
    const outside = join(root, "outside");
    const outsideSkill = join(outside, "SKILL.md");
    await mkdir(dirname(outsideSkill), { recursive: true });
    await writeFile(outsideSkill, "outside relay");
    await mkdir(join(cwd, ".pi", "skills"), { recursive: true });
    await symlink(outside, dirname(projectSkill), "junction");
    await expect(ensureManagedRelaySkills(cwd)).rejects.toThrow("Managed skill path is invalid");
    expect(await readFile(outsideSkill, "utf8")).toBe("outside relay");
  });

  it("leaves complete current content after concurrent management starts", async () => {
    const { cwd, projectSkill, bundledSkill } = await fixture(name);
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, "outdated relay");
    const current = await readFile(bundledSkill, "utf8");
    await Promise.all(Array.from({ length: 4 }, async () => {
      await ensureManagedRelaySkills(cwd);
      expect(await readFile(projectSkill, "utf8")).toBe(current);
    }));
    // SDK queue registration resolves the key before waiting; resolving the
    // replaced file itself can hold a Windows handle during another rename.
    expect(withFileMutationQueue).toHaveBeenCalledWith(dirname(projectSkill), expect.any(Function));
    expect(withFileMutationQueue).not.toHaveBeenCalledWith(projectSkill, expect.any(Function));
    expect(await readdir(dirname(projectSkill))).toEqual(["SKILL.md"]);
  });

  it("loads the refreshed project skill and the real Relay package without a redundant warning", async () => {
    const { cwd, agentDir, projectSkill, bundledSkill } = await fixture(name);
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, `---\nname: ${name}\ndescription: Old Relay skill\n---\nOld content\n`);
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory({ packages: [relayPackage] }),
      noExtensions: true,
      noContextFiles: true,
      noThemes: true,
      noPromptTemplates: true,
      skillsOverride: (base) => deduplicateBundledRelaySkills(cwd, base),
    });
    await loader.reload();
    expect(loader.getSkills().diagnostics).toContainEqual(expect.objectContaining({ type: "collision" }));
    expect(await readFile(projectSkill, "utf8")).toContain("Old content");

    await ensureManagedRelaySkills(cwd);
    await loader.reload();
    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(loader.getSkills().skills.filter((skill) => skill.name === name).map((skill) => skill.filePath)).toEqual([projectSkill]);
    expect(await readFile(projectSkill, "utf8")).toBe(await readFile(bundledSkill, "utf8"));

    await rm(projectSkill);
    await loader.reload();
    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(loader.getSkills().skills.filter((skill) => skill.name === name)).toHaveLength(1);
  });
});

describe.each(skillNames)("bundled %s duplicate diagnostics", (name) => {
  it("removes only identical bundled/project collisions, including CRLF copies", async () => {
    const { cwd, projectSkill, bundledSkill } = await fixture(name);
    await ensureManagedRelaySkills(cwd);
    await writeFile(projectSkill, (await readFile(bundledSkill, "utf8")).replace(/\r?\n/g, "\r\n"));
    const warning: ResourceDiagnostic = { type: "warning", path: projectSkill, message: "preserve this warning" };
    expect(deduplicateBundledRelaySkills(cwd, {
      skills: [],
      diagnostics: [collision(name, projectSkill, bundledSkill), collision(name, bundledSkill, projectSkill), warning],
    }).diagnostics).toEqual([warning]);
  });

  it("preserves collisions with third-party skills even when their content matches", async () => {
    const { root, cwd, projectSkill, bundledSkill } = await fixture(name);
    await ensureManagedRelaySkills(cwd);
    const other = join(root, "other-relay.md");
    await writeFile(other, await readFile(bundledSkill));
    const diagnostic = collision(name, projectSkill, other);
    expect(deduplicateBundledRelaySkills(cwd, { skills: [], diagnostics: [diagnostic] }).diagnostics).toEqual([diagnostic]);
  });

  it("retains stale diagnostics when a referenced file no longer exists", async () => {
    const { cwd, projectSkill, bundledSkill } = await fixture(name);
    const diagnostic = collision(name, projectSkill, bundledSkill);
    expect(deduplicateBundledRelaySkills(cwd, { skills: [], diagnostics: [diagnostic] }).diagnostics).toEqual([diagnostic]);
  });
});
