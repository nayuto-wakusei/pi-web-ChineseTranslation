import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectTrustStore,
  DefaultResourceLoader,
  SettingsManager,
  type ProjectTrustContext,
  type ProjectTrustHandler,
} from "../../piSdk.js";
import { emitWebProjectTrustEvent, resolveWebProjectTrusted, type WebProjectTrustExtensionSet } from "./projectTrust.js";
import { createScopedSettingsManager } from "./projectSettingsScope.js";

/**
 * Unit coverage for the web mirror of the SDK's `project_trust` event flow:
 * pre-trust extensions may decide trust (first `yes`/`no` wins, `undecided`
 * falls through), `remember` writes the agent dir's `trust.json`, handler
 * errors surface through the extension-error reporting path, and the
 * saved-decision/`defaultProjectTrust` fallback is preserved. The extension
 * bundles use the narrow {@link WebProjectTrustExtensionSet} slice the web
 * resolution reads; the real extension registration path (`pi.on`) is covered
 * by the acceptance tests.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A cwd that ships a trust-requiring `.pi/` resource (an extensions dir). */
async function trustRequiringCwd(): Promise<string> {
  const cwd = await tempDir("pi-web-trust-unit-project-");
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  return cwd;
}

async function agentDir(defaultProjectTrust: "always" | "never" | "ask" = "ask"): Promise<string> {
  const dir = await tempDir("pi-web-trust-unit-agent-");
  await writeFile(join(dir, "settings.json"), `${JSON.stringify({ defaultProjectTrust })}\n`);
  return dir;
}

/** An extension bundle shaped like the SDK `LoadExtensionsResult` slice the emitter reads. */
function extensionSet(...extensions: WebProjectTrustExtensionSet["extensions"][number][]): WebProjectTrustExtensionSet {
  return { extensions };
}

/** An extension registering the given `project_trust` handlers. */
function trustExtension(path: string, ...handlers: ProjectTrustHandler[]): WebProjectTrustExtensionSet["extensions"][number] {
  return { path, handlers: new Map([["project_trust", handlers]]) };
}

const trustContext: ProjectTrustContext = {
  cwd: "/workspace",
  mode: "rpc",
  hasUI: false,
  ui: {
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
    input: () => Promise.resolve(undefined),
    notify: () => undefined,
  },
};

async function resolve(options: {
  cwd: string;
  agentDirPath: string;
  extensionsResult?: WebProjectTrustExtensionSet;
  onExtensionError?: (message: string) => void;
}): Promise<boolean> {
  return resolveWebProjectTrusted({
    cwd: options.cwd,
    trustStore: new ProjectTrustStore(options.agentDirPath),
    settingsManager: SettingsManager.create(options.cwd, options.agentDirPath),
    ...(options.extensionsResult === undefined ? {} : { extensionsResult: options.extensionsResult }),
    ...(options.onExtensionError === undefined ? {} : { onExtensionError: options.onExtensionError }),
  });
}

describe("emitWebProjectTrustEvent", () => {
  it("returns the first yes/no handler result, skipping undecided and later handlers", async () => {
    const result = await emitWebProjectTrustEvent(
      extensionSet(
        trustExtension(
          "/ext/a.js",
          () => ({ trusted: "undecided" }),
          () => ({ trusted: "yes", remember: true }),
        ),
      ),
      { type: "project_trust", cwd: "/workspace" },
      trustContext,
    );

    expect(result).toEqual({ result: { trusted: "yes", remember: true }, errors: [] });
  });

  it("collects handler errors and still lets later extensions decide", async () => {
    const result = await emitWebProjectTrustEvent(
      extensionSet(
        trustExtension("/ext/a.js", () => {
          throw new Error("boom");
        }),
        trustExtension("/ext/b.js", () => ({ trusted: "no" })),
      ),
      { type: "project_trust", cwd: "/workspace" },
      trustContext,
    );

    expect(result).toEqual({ result: { trusted: "no" }, errors: [{ extensionPath: "/ext/a.js", error: "boom" }] });
  });

  it("returns no result when every handler is undecided or absent", async () => {
    const undecidedOnly = await emitWebProjectTrustEvent(
      extensionSet(trustExtension("/ext/a.js", () => ({ trusted: "undecided" }))),
      { type: "project_trust", cwd: "/workspace" },
      trustContext,
    );
    expect(undecidedOnly).toEqual({ result: undefined, errors: [] });

    const noHandlers = await emitWebProjectTrustEvent(extensionSet(), { type: "project_trust", cwd: "/workspace" }, trustContext);
    expect(noHandlers).toEqual({ result: undefined, errors: [] });
  });
});

describe("resolveWebProjectTrusted", () => {
  it("uses real pre-trust global extension handlers without loading project extensions", async () => {
    const cwd = await trustRequiringCwd();
    const agent = await agentDir("always");
    await mkdir(join(agent, "extensions"), { recursive: true });
    const globalExtension = join(agent, "extensions", "trust-decision.ts");
    const projectExtension = join(cwd, ".pi", "extensions", "project-extension.ts");
    await writeFile(globalExtension, 'export default function (pi) { pi.on("project_trust", () => ({ trusted: "no", remember: true })); }\n');
    await writeFile(projectExtension, 'export default function (pi) { pi.on("session_start", () => {}); }\n');
    const settingsManager = SettingsManager.create(cwd, agent, { projectTrusted: false });
    const loader = new DefaultResourceLoader({ cwd, agentDir: agent, settingsManager });
    const errors: string[] = [];
    await loader.reload({ resolveProjectTrust: ({ extensionsResult }) => resolveWebProjectTrusted({
      cwd, extensionsResult, settingsManager, trustStore: new ProjectTrustStore(agent),
      onExtensionError: (message) => errors.push(message),
    }) });
    expect(errors).toEqual([]);
    expect(settingsManager.isProjectTrusted()).toBe(false);
    expect(new ProjectTrustStore(agent).get(cwd)).toBe(false);
    expect(loader.getExtensions().extensions.some((extension) => extension.path === globalExtension)).toBe(true);
    expect(loader.getExtensions().extensions.some((extension) => extension.path === projectExtension)).toBe(false);
  });

  it("gates actual SDK project resources and settings until explicit trust, preserving scoped preferences", async () => {
    const cwd = await trustRequiringCwd();
    const agent = await agentDir("ask");
    const scopeDirectory = await tempDir("pi-web-trust-preferences-");
    await mkdir(join(cwd, ".pi", "prompts"), { recursive: true });
    await writeFile(join(cwd, ".pi", "prompts", "trusted-only.md"), "---\ndescription: Project fixture\n---\nProject fixture content\n");
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ defaultModel: "project-model" }));
    await writeFile(join(scopeDirectory, "settings.preferences.json"), JSON.stringify({ defaultModel: "scoped-model" }));
    const settingsManager = await createScopedSettingsManager({ cwd, scopeDirectory, globalAgentDir: agent, mode: "normal", projectTrusted: false });
    const loader = new DefaultResourceLoader({ cwd, agentDir: agent, settingsManager });
    const reload = () => loader.reload({ resolveProjectTrust: ({ extensionsResult }) => resolveWebProjectTrusted({
      cwd, extensionsResult, settingsManager, trustStore: new ProjectTrustStore(agent),
    }) });
    await reload();
    expect(settingsManager.isProjectTrusted()).toBe(false);
    expect(settingsManager.getDefaultModel()).toBe("scoped-model");
    expect(loader.getPrompts().prompts.some((prompt) => prompt.name === "trusted-only")).toBe(false);
    expect(new ProjectTrustStore(agent).get(cwd)).toBeNull();
    new ProjectTrustStore(agent).set(cwd, true);
    await reload();
    expect(settingsManager.isProjectTrusted()).toBe(true);
    expect(settingsManager.getDefaultModel()).toBe("project-model");
    expect(loader.getPrompts().prompts.some((prompt) => prompt.name === "trusted-only")).toBe(true);
    new ProjectTrustStore(agent).set(cwd, false);
    await reload();
    expect(settingsManager.isProjectTrusted()).toBe(false);
    expect(settingsManager.getDefaultModel()).toBe("scoped-model");
    expect(loader.getPrompts().prompts.some((prompt) => prompt.name === "trusted-only")).toBe(false);
  });
  it("trusts a cwd without trust-requiring resources without invoking extensions", async () => {
    const cwd = await tempDir("pi-web-trust-unit-plain-");
    const agent = await agentDir("never");
    const handler = vi.fn(() => ({ trusted: "no" as const }));

    await expect(resolve({ cwd, agentDirPath: agent, extensionsResult: extensionSet(trustExtension("/ext/a.js", handler)) })).resolves.toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets an extension decision beat defaultProjectTrust with no saved decision", async () => {
    const cwd = await trustRequiringCwd();
    const agent = await agentDir("never");

    await expect(
      resolve({ cwd, agentDirPath: agent, extensionsResult: extensionSet(trustExtension("/ext/a.js", () => ({ trusted: "yes" }))) }),
    ).resolves.toBe(true);

    await expect(
      resolve({ cwd, agentDirPath: agent, extensionsResult: extensionSet(trustExtension("/ext/a.js", () => ({ trusted: "no" }))) }),
    ).resolves.toBe(false);
  });

  it("lets an extension decision beat a saved decision, mirroring the SDK order", async () => {
    const cwd = await trustRequiringCwd();
    const agent = await agentDir("always");
    await writeFile(join(agent, "trust.json"), `${JSON.stringify({ [cwd]: true })}\n`);

    await expect(
      resolve({ cwd, agentDirPath: agent, extensionsResult: extensionSet(trustExtension("/ext/a.js", () => ({ trusted: "no" }))) }),
    ).resolves.toBe(false);
  });

  it("writes the trust store when an extension asks to remember", async () => {
    const cwd = await trustRequiringCwd();
    const agent = await agentDir("never");

    await expect(
      resolve({ cwd, agentDirPath: agent, extensionsResult: extensionSet(trustExtension("/ext/a.js", () => ({ trusted: "yes", remember: true }))) }),
    ).resolves.toBe(true);
    expect(new ProjectTrustStore(agent).get(cwd)).toBe(true);

    await expect(
      resolve({ cwd, agentDirPath: agent, extensionsResult: extensionSet(trustExtension("/ext/a.js", () => ({ trusted: "no", remember: true }))) }),
    ).resolves.toBe(false);
    expect(new ProjectTrustStore(agent).get(cwd)).toBe(false);
  });

  it("falls back to the saved decision when the event is undecided", async () => {
    const cwd = await trustRequiringCwd();
    const agent = await agentDir("never");
    await writeFile(join(agent, "trust.json"), `${JSON.stringify({ [cwd]: true })}\n`);

    await expect(
      resolve({ cwd, agentDirPath: agent, extensionsResult: extensionSet(trustExtension("/ext/a.js", () => ({ trusted: "undecided" }))) }),
    ).resolves.toBe(true);
  });

  it("falls back to defaultProjectTrust when no extension decides and no decision is saved", async () => {
    const cwd = await trustRequiringCwd();

    await expect(resolve({ cwd, agentDirPath: await agentDir("always") })).resolves.toBe(true);
    await expect(resolve({ cwd, agentDirPath: await agentDir("never") })).resolves.toBe(false);
    // `ask` cannot prompt in the browser: headless parity means untrusted.
    await expect(resolve({ cwd, agentDirPath: await agentDir("ask") })).resolves.toBe(false);
  });

  it("reports handler errors via onExtensionError and preserves the fallback", async () => {
    const cwd = await trustRequiringCwd();
    const agent = await agentDir("never");
    const errors: string[] = [];

    const trusted = await resolve({
      cwd,
      agentDirPath: agent,
      extensionsResult: extensionSet(
        trustExtension("/ext/a.js", () => {
          throw new Error("decider exploded");
        }),
        trustExtension("/ext/b.js", () => ({ trusted: "undecided" })),
      ),
      onExtensionError: (message) => errors.push(message),
    });

    expect(errors).toEqual(['Extension "/ext/a.js" project_trust error: decider exploded']);
    expect(trusted).toBe(false);
  });
});
