import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DefaultResourceLoader, loadSkills, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterManagedProjectSkills, filterManagedWorkbenchSkills, PiSessionService } from "./piSessionService.js";
import { ensureManagedRelaySkills } from "./relaySkill.js";
import { createTestModelRuntime } from "./modelRuntime.testSupport.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";

let root: string;
let cwd: string;
let agentDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-web-managed-skill-isolation-"));
  cwd = join(root, "workspace");
  agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function writeSkill(path: string, name = "relay", body = "Follow the relay charter."): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `---\nname: ${name}\ndescription: Relay test skill\n---\n${body}\n`);
  return path;
}

async function ensureManagedRelaySkill(workspace: string, bundled?: string): Promise<string> {
  const directory = bundled === undefined ? undefined : dirname(dirname(bundled));
  if (directory !== undefined) await writeSkill(join(directory, "relay-runner", "SKILL.md"), "relay-runner");
  const paths = await ensureManagedRelaySkills(workspace, directory);
  const relay = paths[0];
  if (relay === undefined) throw new Error("Missing managed Relay fixture");
  return relay;
}

describe("managed skill name collision isolation", () => {
  it("refreshes the managed copy on start and /reload while ordinary sessions keep global skills", async () => {
    const global = await writeSkill(join(agentDir, "skills", "global-only", "SKILL.md"), "global-only");
    const project = await writeSkill(join(cwd, ".pi", "skills", "relay", "SKILL.md"), "relay", "Old managed content");
    const custom = await writeSkill(join(cwd, ".pi", "skills", "custom", "SKILL.md"), "custom");
    const bundled = await readFile(new URL("../../../skills/relay/SKILL.md", import.meta.url), "utf8");
    const originalCustom = await readFile(custom, "utf8");
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ skills: [global], packages: [], extensions: [] }));
    const { modelRuntime } = await createTestModelRuntime();
    const service = new PiSessionService(new SessionEventHub(), {
      agentDir,
      dataDir: join(root, "data"),
      modelRuntime,
      managementModelRuntime: modelRuntime,
      normalModelRuntimeForCwd: () => Promise.resolve(modelRuntime),
    });
    const managementContext = { user: { id: "user", rootUserId: "root-user", roles: [], permissions: [] }, projects: [] };
    try {
      const managed = await service.start(cwd, { managementContext });
      const ref = { id: managed.id, cwd };
      expect(await readFile(project, "utf8")).toBe(bundled);
      const commands = await service.commands(ref, managementContext);
      expect(commands.map((command) => command.name)).toEqual(expect.arrayContaining(["skill:relay", "skill:custom"]));
      expect(commands.some((command) => command.name === "skill:global-only")).toBe(false);
      await writeFile(project, "outdated again");
      await service.runCommand(ref, "/reload", managementContext);
      expect(await readFile(project, "utf8")).toBe(bundled);
      expect(await readFile(custom, "utf8")).toBe(originalCustom);
      expect((await service.status(ref, managementContext)).warnings?.filter((warning) => warning.source === "skill") ?? []).toEqual([]);

      await writeFile(project, "ordinary mode must not overwrite this");
      const ordinary = await service.start(cwd);
      expect((await service.commands({ id: ordinary.id, cwd })).some((command) => command.name === "skill:global-only")).toBe(true);
      expect(await readFile(project, "utf8")).toBe("ordinary mode must not overwrite this");
    } finally {
      await service.dispose();
    }
  });

  it.each([false, true])("retains the default project copy regardless of package-first=%s discovery", async (packageFirst) => {
    const bundled = await writeSkill(join(root, "package", "skills", "relay", "SKILL.md"));
    const project = await ensureManagedRelaySkill(cwd, bundled);
    const paths = packageFirst ? [bundled, project] : [project, bundled];
    const raw = loadSkills({ cwd, agentDir, skillPaths: paths, includeDefaults: false });

    expect(await readFile(project, "utf8")).toBe(await readFile(bundled, "utf8"));
    expect(raw.skills.map((skill) => skill.filePath)).toEqual([paths[0]]);
    expect(raw.diagnostics).toContainEqual(expect.objectContaining({ type: "collision" }));

    const loader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager: SettingsManager.inMemory(),
      noExtensions: true, noContextFiles: true, noSkills: true, noThemes: true, noPromptTemplates: true,
      additionalSkillPaths: paths,
      skillsOverride: (base) => filterManagedProjectSkills(cwd, base),
    });
    await loader.reload();
    expect(loader.getSkills().skills.map((skill) => skill.filePath)).toEqual([project]);
    expect(loader.getSkills().diagnostics).toEqual([]);
    await loader.reload();
    expect(loader.getSkills().skills.map((skill) => skill.filePath)).toEqual([project]);
    expect(loader.getSkills().diagnostics).toEqual([]);
  });

  it("restores an authorized Workbench skill shadowed by an unauthorized project skill", async () => {
    const unauthorized = await writeSkill(join(cwd, ".pi", "skills", "custom", "relay", "SKILL.md"), "relay", "Unauthorized content");
    const authorized = await writeSkill(join(cwd, ".pi", "skills", "workbench-approved", "relay", "SKILL.md"));
    const raw = loadSkills({ cwd, agentDir, skillPaths: [unauthorized, authorized], includeDefaults: false });
    const receipt = {
      authorizationRevision: 1,
      skills: [{ name: "relay", version: "1", directory: "workbench-approved", contentSha256: "hash", files: [], degradedCapabilities: [] }],
    };
    const result = filterManagedWorkbenchSkills(cwd, raw, receipt);
    expect(result.skills.map((skill) => skill.filePath)).toEqual([authorized]);
    expect(result.diagnostics).toEqual([]);
  });

  it("refreshes the managed Relay copy without changing other project skills", async () => {
    const bundled = await writeSkill(join(root, "package", "relay", "SKILL.md"));
    const project = await writeSkill(join(cwd, ".pi", "skills", "relay", "SKILL.md"), "relay", "Project-specific instructions");
    const custom = await writeSkill(join(cwd, ".pi", "skills", "custom", "SKILL.md"), "custom", "Project-specific instructions");
    const original = await readFile(custom, "utf8");
    await ensureManagedRelaySkill(cwd, bundled);
    const raw = loadSkills({ cwd, agentDir, skillPaths: [bundled, project], includeDefaults: false });
    const result = filterManagedProjectSkills(cwd, raw);
    expect(result.skills.map((skill) => skill.filePath)).toEqual([project]);
    expect(result.diagnostics).toEqual([]);
    expect(await readFile(project, "utf8")).toBe(await readFile(bundled, "utf8"));
    expect(await readFile(custom, "utf8")).toBe(original);
  });

  it("keeps the bundled version complete during concurrent starts", async () => {
    const bundled = await writeSkill(join(root, "package", "relay", "SKILL.md"));
    const project = await writeSkill(join(cwd, ".pi", "skills", "relay", "SKILL.md"), "relay", "Old bundled content");
    const expected = await readFile(bundled, "utf8");
    await Promise.all(Array.from({ length: 4 }, async () => {
      await ensureManagedRelaySkill(cwd, bundled);
      expect(await readFile(project, "utf8")).toBe(expected);
    }));
  });

  it("excludes global and parent-project skills even when they have unique names", async () => {
    const global = await writeSkill(join(agentDir, "skills", "global-only", "SKILL.md"), "global-only");
    const parent = await writeSkill(join(root, ".pi", "skills", "parent-only", "SKILL.md"), "parent-only");
    const project = await writeSkill(join(cwd, ".pi", "skills", "local-only", "SKILL.md"), "local-only");
    const raw = loadSkills({ cwd, agentDir, skillPaths: [global, parent, project], includeDefaults: false });
    expect(raw.skills).toHaveLength(3);
    const result = filterManagedProjectSkills(cwd, raw, agentDir);
    expect(result.skills.map((skill) => skill.filePath)).toEqual([project]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains validation warnings exactly once when recovering a permitted copy", async () => {
    const outside = await writeSkill(join(root, "package", "relay", "SKILL.md"), "relay--invalid");
    const project = await writeSkill(join(cwd, ".pi", "skills", "relay", "SKILL.md"), "relay--invalid");
    const raw = loadSkills({ cwd, agentDir, skillPaths: [outside, project], includeDefaults: false });
    const result = filterManagedProjectSkills(cwd, raw);
    expect(result.skills.map((skill) => skill.filePath)).toEqual([project]);
    expect(result.diagnostics).toEqual([{ type: "warning", path: project, message: "name must not contain consecutive hyphens" }]);
  });

  it("preserves real conflicts between allowed skills after excluding an outside winner", async () => {
    const outside = await writeSkill(join(root, "package", "relay", "SKILL.md"));
    const first = await writeSkill(join(cwd, "a", "relay", "SKILL.md"), "relay", "First content");
    const second = await writeSkill(join(cwd, "b", "relay", "SKILL.md"), "relay", "Different content");
    const raw = loadSkills({ cwd, agentDir, skillPaths: [outside, first, second], includeDefaults: false });
    const result = filterManagedProjectSkills(cwd, raw);
    expect(result.skills.map((skill) => skill.filePath)).toEqual([first]);
    expect(result.diagnostics).toEqual([{
      type: "collision", message: 'name "relay" collision', path: second,
      collision: { resourceType: "skill", name: "relay", winnerPath: first, loserPath: second },
    }]);
  });

  it("does not recover an outside skill through a workspace junction", async () => {
    const outside = await writeSkill(join(root, "package", "relay", "SKILL.md"));
    const linkedDirectory = join(cwd, "linked-relay");
    await symlink(dirname(outside), linkedDirectory, "junction");
    const raw = loadSkills({ cwd, agentDir, skillPaths: [outside, join(linkedDirectory, "SKILL.md")], includeDefaults: false });
    expect(filterManagedProjectSkills(cwd, raw)).toEqual({ skills: [], diagnostics: [] });
  });
});
