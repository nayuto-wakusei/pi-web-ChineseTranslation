import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager, withFileMutationQueue, type ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deduplicateBundledRelaySkills, ensureManagedRelaySkills, removeUnmodifiedManagedRelaySkills } from "./relaySkill.js";

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
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-web-relay-sync-")));
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
    // Cleanup can remove a child directory; both operations queue on its stable parent.
    expect(withFileMutationQueue).toHaveBeenCalledWith(dirname(dirname(projectSkill)), expect.any(Function));
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

describe("full-privilege Relay cleanup", () => {
  it("does not create missing project directories", async () => {
    const { cwd } = await fixture("relay-runner");
    await removeUnmodifiedManagedRelaySkills(cwd);
    await expect(readdir(join(cwd, ".pi"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["current", "legacy"] as const)("removes only an original %s runner, including CRLF copies", async (version) => {
    const { cwd, projectSkill, bundledSkill } = await fixture("relay-runner");
    const content = await readFile(version === "current" ? bundledSkill : new URL("./fixtures/relay-runner-legacy.md", import.meta.url), "utf8");
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, content.replace(/\r?\n/g, "\r\n"));
    await removeUnmodifiedManagedRelaySkills(cwd);
    await expect(readdir(dirname(projectSkill))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(skillNames.flatMap((name) => ["edited template", "additional file"].map((change) => ({ name, change }))))("preserves $name with $change", async ({ name, change }) => {
    const { cwd, projectSkill, bundledSkill } = await fixture(name);
    const content = await readFile(bundledSkill, "utf8") + (change === "edited template" ? "\nCustom instructions\n" : "");
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, content);
    if (change === "additional file") await writeFile(join(dirname(projectSkill), "custom.txt"), "User file");
    await removeUnmodifiedManagedRelaySkills(cwd);
    expect(await readFile(projectSkill, "utf8")).toBe(content);
    if (change === "additional file") expect(await readFile(join(dirname(projectSkill), "custom.txt"), "utf8")).toBe("User file");
  });

  it("preserves user edits to a historical template instead of treating its name as ownership", async () => {
    const { cwd, projectSkill } = await fixture("relay-runner");
    const content = await readFile(new URL("./fixtures/relay-runner-legacy.md", import.meta.url), "utf8") + "\nUser changes\n";
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(projectSkill, content);
    await removeUnmodifiedManagedRelaySkills(cwd);
    expect(await readFile(projectSkill, "utf8")).toBe(content);
  });

  it.each([".pi", "skills", "relay-runner"])("does not remove a copy through a %s junction", async (part) => {
    const { root, cwd, bundledSkill } = await fixture("relay-runner");
    const outside = join(root, "outside");
    const link = part === ".pi" ? join(cwd, ".pi") : part === "skills" ? join(cwd, ".pi", "skills") : join(cwd, ".pi", "skills", "relay-runner");
    const relativeFile = part === ".pi" ? join("skills", "relay-runner", "SKILL.md") : part === "skills" ? join("relay-runner", "SKILL.md") : "SKILL.md";
    const outsideSkill = join(outside, relativeFile);
    await mkdir(dirname(outsideSkill), { recursive: true });
    const content = await readFile(bundledSkill, "utf8");
    await writeFile(outsideSkill, content);
    await mkdir(dirname(link), { recursive: true });
    await symlink(outside, link, "junction");
    await removeUnmodifiedManagedRelaySkills(cwd);
    expect(await readFile(outsideSkill, "utf8")).toBe(content);
  });

  it("serializes cleanup with concurrent restricted synchronization", async () => {
    const { cwd, projectSkill, bundledSkill } = await fixture("relay-runner");
    await ensureManagedRelaySkills(cwd);
    await Promise.all(Array.from({ length: 4 }, async () => {
      await removeUnmodifiedManagedRelaySkills(cwd);
      await ensureManagedRelaySkills(cwd);
    }));
    expect(await readFile(projectSkill, "utf8")).toBe(await readFile(bundledSkill, "utf8"));
    expect(await readdir(dirname(projectSkill))).toEqual(["SKILL.md"]);
  });
});
