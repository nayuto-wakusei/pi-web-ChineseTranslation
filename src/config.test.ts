import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS, DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX, DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS, DEFAULT_MAX_UPLOAD_BYTES, DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS, DEFAULT_NORMAL_TOOL_AUDIT_RETENTION_DAYS, DEFAULT_UPLOADS_FOLDER, agentDirEnvSource, agentSessionDirEnvKeys, agentSessionDirEnvOverride, askUserEnabled, effectiveAgentConfig, effectivePiWebConfig, hasAgentDirEnvOverride, hasAgentSessionDirEnvOverride, loadPiWebConfig, maxUploadBytes, offlineModeEnabled, savePiWebConfig, spawnSessionsEnabled, subsessionsEnabled } from "./config.js";

let tempDir: string;
let configPath: string;
const TEST_PASSWORD_HASH = "pbkdf2-sha256$120000$c2FsdA$ZmFrZS1oYXNo";
const NEXT_TEST_PASSWORD_HASH = "pbkdf2-sha256$120000$c2FsdDI$bmV4dC1oYXNo";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-config-test-"));
  configPath = join(tempDir, "config.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("PI WEB config persistence", () => {
  it("writes and reads the configured PI WEB config path", () => {
    const requestedConfig = {
      host: "0.0.0.0",
      port: 9000,
      allowedHosts: ["example.local"],
      shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null },
      plugins: { "workspace-tasks": { enabled: false, settings: { configPath: ".pi-web/tasks.json" } } },
      normalAuth: { passwordHash: TEST_PASSWORD_HASH },
      pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] },
      uploads: { defaultFolder: "manual\\incoming" },
    };
    const normalizedConfig = {
      ...requestedConfig,
      uploads: { defaultFolder: "manual/incoming" },
    };

    const saved = savePiWebConfig(requestedConfig, testOptions());

    expect(saved).toEqual({ path: configPath, exists: true, config: normalizedConfig });
    expect(loadPiWebConfig(testOptions())).toEqual(saved);
  });

  it("preserves unrelated config keys while replacing managed keys", async () => {
    await writeFile(configPath, `${JSON.stringify({ host: "old", port: 8504, allowedHosts: true, plugins: { info: { enabled: false } }, normalAuth: { passwordHash: TEST_PASSWORD_HASH }, pathAccess: { allowedPaths: ["/old"] }, uploads: { defaultFolder: "old" }, future: { enabled: true } }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000, allowedHosts: [], normalAuth: { passwordHash: NEXT_TEST_PASSWORD_HASH }, pathAccess: { allowedPaths: ["/new"] }, uploads: { defaultFolder: "new" } }, testOptions());

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ future: { enabled: true }, port: 9000, allowedHosts: [], normalAuth: { passwordHash: NEXT_TEST_PASSWORD_HASH }, pathAccess: { allowedPaths: ["/new"] }, uploads: { defaultFolder: "new" } });
  });

  it("preserves normalAuth when saving settings that do not include it", async () => {
    await writeFile(configPath, `${JSON.stringify({ normalAuth: { passwordHash: TEST_PASSWORD_HASH }, future: { enabled: true } }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000, allowedHosts: [] }, testOptions());

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      future: { enabled: true },
      normalAuth: { passwordHash: TEST_PASSWORD_HASH },
      port: 9000,
      allowedHosts: [],
    });
  });

  it("preserves audit settings when saving settings that do not include them", async () => {
    await writeFile(configPath, `${JSON.stringify({ auditLog: { normalMode: { retentionDays: 30, maxRows: 10_000 } }, future: { enabled: true } }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000 }, testOptions());

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      future: { enabled: true },
      auditLog: { normalMode: { retentionDays: 30, maxRows: 10_000 } },
      port: 9000,
    });
  });

  it("rejects empty and malformed normal auth password hashes", async () => {
    await writeFile(configPath, `${JSON.stringify({ normalAuth: { passwordHash: "" } }, null, 2)}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config normalAuth.passwordHash must use pbkdf2-sha256 format");

    await writeFile(configPath, `${JSON.stringify({ normalAuth: { passwordHash: "not-a-real-hash" } }, null, 2)}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config normalAuth.passwordHash must use pbkdf2-sha256 format");
  });

  it("rejects invalid plugin config", async () => {
    await writeFile(configPath, `${JSON.stringify({ plugins: { info: { enabled: "no" } } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config plugin enabled values must be booleans");
  });

  it("reads and writes local management embed auth config", () => {
    const saved = savePiWebConfig({
      managementEmbed: {
        enabled: true,
        projectRoot: "/root/PiWeb",
        auth: {
          sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
          issuer: "telecom-portal",
          audience: "dify-external-portal",
        },
      },
    }, testOptions());

    expect(saved.config.managementEmbed?.auth).toEqual({
      sharedSecretEnv: "PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN",
      issuer: "telecom-portal",
      audience: "dify-external-portal",
    });
    expect(loadPiWebConfig(testOptions()).config.managementEmbed?.auth).toEqual(saved.config.managementEmbed?.auth);
  });

  it("rejects old management embed introspection auth config", async () => {
    await writeFile(configPath, `${JSON.stringify({
      managementEmbed: {
        enabled: true,
        auth: {
          introspectionUrl: "http://localhost:30032/console/api/auth/external-portal/pi-web/introspect",
          serviceSecretEnv: "PI_WEB_EMBED_SHARED_SECRET",
        },
      },
    }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("only supports local signed tokens");
  });

  it("loads strict workbench integration config and applies environment overrides", async () => {
    await writeFile(configPath, `${JSON.stringify({
      workbenchIntegration: {
        baseUrl: "http://ai-platform-backend:8787",
        mcpUrl: "http://mcp:8000/mcp",
      },
    })}\n`, "utf8");

    const effective = effectivePiWebConfig({
      ...testOptions(),
      env: {
        ...testOptions().env,
        PI_WEB_WORKBENCH_URL: "http://127.0.0.1:8787",
        PI_WEB_MCP_TIMEOUT_MS: "45000",
      },
    }).config.workbenchIntegration;

    expect(effective).toEqual({
      baseUrl: "http://127.0.0.1:8787",
      mcpUrl: "http://mcp:8000/mcp",
      requestTimeoutMs: 10_000,
      capabilityTimeoutMs: 45_000,
      skillBundleMaxBytes: 10 * 1024 * 1024,
      skillFileMaxBytes: 2 * 1024 * 1024,
      skillFileCountMax: 200,
    });
  });

  it("rejects invalid and unknown workbench integration settings", async () => {
    await writeFile(configPath, `${JSON.stringify({ workbenchIntegration: { baseUrl: "not-a-url", mcpUrl: "http://mcp:8000/mcp" } })}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("workbenchIntegration.baseUrl must be an absolute HTTP URL");

    await writeFile(configPath, `${JSON.stringify({ workbenchIntegration: { baseUrl: "http://backend:8787", mcpUrl: "http://mcp:8000/mcp", future: true } })}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("workbenchIntegration contains unknown key");
  });

  it("resolves and validates ordinary-mode audit retention settings", async () => {
    expect(effectivePiWebConfig(testOptions()).config.auditLog).toEqual({
      normalMode: { enabled: true, retentionDays: DEFAULT_NORMAL_TOOL_AUDIT_RETENTION_DAYS, maxRows: DEFAULT_NORMAL_TOOL_AUDIT_MAX_ROWS },
      managementMode: { enabled: false, indexPrefix: DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX, retentionDays: DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS },
    });

    await writeFile(configPath, `${JSON.stringify({ auditLog: { normalMode: { enabled: false, retentionDays: 30, maxRows: 10_000 } } })}\n`, "utf8");
    expect(effectivePiWebConfig(testOptions()).config.auditLog).toEqual({
      normalMode: { enabled: false, retentionDays: 30, maxRows: 10_000 },
      managementMode: { enabled: false, indexPrefix: DEFAULT_MANAGEMENT_AUDIT_INDEX_PREFIX, retentionDays: DEFAULT_MANAGEMENT_AUDIT_RETENTION_DAYS },
    });

    await writeFile(configPath, `${JSON.stringify({ auditLog: { normalMode: { retentionDays: 0 } } })}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("auditLog.normalMode.retentionDays must be a positive integer");
  });

  it("resolves and validates management-mode Elasticsearch audit settings", async () => {
    await writeFile(configPath, `${JSON.stringify({ auditLog: { managementMode: { enabled: true, baseUrl: "http://elasticsearch:9200", indexPrefix: "managed-audit", retentionDays: 366 } } })}\n`, "utf8");
    expect(effectivePiWebConfig(testOptions()).config.auditLog?.managementMode).toEqual({
      enabled: true,
      baseUrl: "http://elasticsearch:9200/",
      indexPrefix: "managed-audit",
      retentionDays: 366,
    });

    await writeFile(configPath, `${JSON.stringify({ auditLog: { managementMode: { enabled: true } } })}\n`, "utf8");
    expect(() => effectivePiWebConfig(testOptions())).toThrow("management audit requires");

    await writeFile(configPath, `${JSON.stringify({ auditLog: { managementMode: { baseUrl: "http://elasticsearch:9200", indexPrefix: "Bad*Prefix" } } })}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("must be a lowercase Elasticsearch index prefix");
  });

  it("rejects invalid path access config", async () => {
    await writeFile(configPath, `${JSON.stringify({ pathAccess: { allowedPaths: [""] } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config pathAccess.allowedPaths must be an array of non-empty strings");
  });

  it("persists and reads maxUploadBytes", () => {
    savePiWebConfig({ maxUploadBytes: 1234 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.maxUploadBytes).toBe(1234);
  });

  it("keeps a hand-edited extensionDialogsTimeoutMs across settings saves", async () => {
    await writeFile(configPath, `${JSON.stringify({ extensionDialogsTimeoutMs: 60_000 }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000 }, testOptions());

    expect(loadPiWebConfig(testOptions()).config.extensionDialogsTimeoutMs).toBe(60_000);
  });

  it("rejects an invalid extensionDialogsTimeoutMs", async () => {
    for (const value of [-1, 1.5, "5000", null]) {
      await writeFile(configPath, `${JSON.stringify({ extensionDialogsTimeoutMs: value }, null, 2)}\n`, "utf8");

      expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config extensionDialogsTimeoutMs must be a non-negative integer");
    }
  });

  it("persists and reads custom agent runtime settings", () => {
    savePiWebConfig({ agent: { command: "acme-agent", dir: "/opt/acme-agent/state" } }, testOptions());

    expect(loadPiWebConfig(testOptions()).config.agent).toEqual({ command: "acme-agent", dir: "/opt/acme-agent/state" });
  });

  it("defaults to the Pi agent directory only for canonical Pi companion names", () => {
    for (const command of ["pi", "pi.cmd"]) {
      expect(effectiveAgentConfig({ HOME: join(tempDir, ".home") }, { agent: { command } })).toMatchObject({
        command,
        dir: join(tempDir, ".home", ".pi", "agent"),
        sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"],
      });
    }
  });

  it("requires explicit state for alternate names and absolute Pi launchers", () => {
    const absolutePiCommand = join(tempDir, "bin", "pi");
    for (const command of ["acme-agent", absolutePiCommand]) {
      expect(() => effectiveAgentConfig({}, { agent: { command } })).toThrow(`PI WEB config agent.dir or PI_WEB_AGENT_DIR is required when agent.command is ${JSON.stringify(command)}`);
      expect(() => savePiWebConfig({ agent: { command } }, testOptions())).toThrow(`PI WEB config agent.dir or PI_WEB_AGENT_DIR is required when agent.command is ${JSON.stringify(command)}`);
    }
  });

  it("accepts safe bare executable names and host-absolute executable paths", () => {
    const absoluteCommand = join(tempDir, "bin", "acme-agent");
    const agentDir = join(tempDir, "state", "acme");

    expect(effectiveAgentConfig({}, { agent: { command: "acme-agent", dir: agentDir } })).toMatchObject({ command: "acme-agent", dir: agentDir });
    expect(effectiveAgentConfig({}, { agent: { command: absoluteCommand, dir: agentDir } })).toMatchObject({ command: absoluteCommand, dir: agentDir });
  });

  it.each(["./acme-agent", "bin/acme-agent", "../acme-agent", "node acme-agent.js", "acme-agent;other", "-acme-agent"])("rejects unsafe or workspace-relative agent command %j", (command) => {
    expect(() => savePiWebConfig({ agent: { command, dir: join(tempDir, "agent") } }, testOptions())).toThrow("safe bare executable name or host-absolute executable path");
  });

  it.skipIf(process.platform === "win32")("rejects foreign-platform absolute agent command and state paths", () => {
    expect(() => effectiveAgentConfig({}, { agent: { command: "C:\\tools\\acme-agent.exe", dir: join(tempDir, "agent") } })).toThrow("safe bare executable name or host-absolute executable path");
    expect(() => effectiveAgentConfig({}, { agent: { command: "acme-agent", dir: "C:\\profiles\\acme" } })).toThrow("agent.dir must be a host-absolute path");
  });

  it("rejects home expansion that would create a workspace-relative agent directory", () => {
    expect(() => effectiveAgentConfig({ HOME: "relative-home" })).toThrow("agent.dir must be a host-absolute path");
  });

  it("resolves explicit alternate agent command and state directory settings", () => {
    expect(effectiveAgentConfig({ HOME: join(tempDir, ".home") }, { agent: { command: "acme-agent", dir: "~/agent-profiles/acme" } })).toMatchObject({
      command: "acme-agent",
      dir: join(tempDir, ".home", "agent-profiles", "acme"),
      sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"],
    });
  });

  it("ignores empty agent environment overrides", () => {
    const env = {
      HOME: join(tempDir, ".home"),
      PI_WEB_AGENT_COMMAND: "",
      PI_WEB_AGENT_DIR: "",
      PI_WEB_AGENT_SESSION_DIR: "",
      PI_CODING_AGENT_DIR: "",
      PI_CODING_AGENT_SESSION_DIR: "",
    };

    expect(effectiveAgentConfig(env, { agent: { command: "acme-agent", dir: "~/agent-profiles/acme" } })).toMatchObject({
      command: "acme-agent",
      dir: join(tempDir, ".home", "agent-profiles", "acme"),
    });
    expect(hasAgentDirEnvOverride(env)).toBe(false);
    expect(hasAgentSessionDirEnvOverride(env, "acme-agent")).toBe(false);
  });

  it("uses explicit PI WEB agent directory env precedence", () => {
    const env = {
      PI_WEB_AGENT_COMMAND: "acme-agent",
      PI_WEB_AGENT_DIR: join(tempDir, "web-env-agent"),
      PI_CODING_AGENT_DIR: join(tempDir, "pi-env-agent"),
    };
    expect(effectiveAgentConfig(env, { agent: { command: "pi", dir: join(tempDir, "config-agent") } })).toMatchObject({
      command: "acme-agent",
      dir: join(tempDir, "web-env-agent"),
    });
    expect(agentDirEnvSource(env)).toBe("pi-web");
  });

  it("uses canonical Pi env directory overrides for every command", () => {
    const legacyDir = join(tempDir, "pi-env-agent");
    const alternateDir = join(tempDir, "alternate-agent");
    const env = { PI_CODING_AGENT_DIR: legacyDir };
    expect(effectiveAgentConfig(env, { agent: { dir: join(tempDir, "config-agent") } })).toMatchObject({ dir: legacyDir });
    expect(effectiveAgentConfig(env, { agent: { command: "acme-agent", dir: alternateDir } })).toMatchObject({ command: "acme-agent", dir: legacyDir });
    expect(agentDirEnvSource(env)).toBe("pi-compatibility");
    expect(hasAgentDirEnvOverride(env)).toBe(true);

    for (const command of ["acme-agent", join(tempDir, "bin", "pi")]) {
      expect(effectiveAgentConfig(env, { agent: { command } }).dir).toBe(legacyDir);
    }
  });

  it("uses only explicit session directory env keys", () => {
    expect(agentSessionDirEnvKeys()).toEqual(["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"]);
    expect(effectiveAgentConfig({ HOME: join(tempDir, ".home"), PI_WEB_AGENT_COMMAND: "acme-agent", PI_WEB_AGENT_DIR: join(tempDir, "agent") }).sessionDirEnvKeys).toEqual(["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"]);
    expect(agentSessionDirEnvKeys(join(tempDir, "bin", "pi"))).toEqual(["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"]);
  });

  it("resolves the old session alias before the canonical Pi alias", () => {
    expect(agentSessionDirEnvOverride({
      PI_WEB_AGENT_SESSION_DIR: join(tempDir, "web-sessions"),
      PI_CODING_AGENT_SESSION_DIR: join(tempDir, "pi-sessions"),
    })).toBe(join(tempDir, "web-sessions"));
    expect(agentSessionDirEnvOverride({ PI_CODING_AGENT_SESSION_DIR: join(tempDir, "pi-sessions") })).toBe(join(tempDir, "pi-sessions"));
  });

  it("rejects unknown nested agent keys instead of erasing them", async () => {
    const original = { agent: { command: "acme-agent", dir: join(tempDir, "agent"), futureSetting: true } };
    await writeFile(configPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow('PI WEB config agent contains unknown key "futureSetting"');
    expect(() => savePiWebConfig({ port: 9000 }, testOptions())).toThrow('PI WEB config agent contains unknown key "futureSetting"');
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(original);
  });

  it("exposes the default upload folder in the effective config", () => {
    expect(effectivePiWebConfig(testOptions()).config.uploads).toEqual({ defaultFolder: DEFAULT_UPLOADS_FOLDER });
  });

  it("resolves askUser in the effective config so the runtime has a single source of truth", async () => {
    expect(effectivePiWebConfig(testOptions()).config.askUser).toBe(true);

    await writeFile(configPath, `${JSON.stringify({ askUser: false }, null, 2)}\n`, "utf8");

    expect(effectivePiWebConfig(testOptions()).config.askUser).toBe(false);
    expect(effectivePiWebConfig({ ...testOptions(), env: { ...testOptions().env, PI_WEB_ASK_USER: "1" } }).config.askUser).toBe(true);
  });

  it("round-trips the askUser key through save and load", () => {
    expect(savePiWebConfig({ askUser: false }, testOptions()).config).toEqual({ askUser: false });
    expect(loadPiWebConfig(testOptions()).config).toEqual({ askUser: false });
  });

  it("rejects a non-boolean askUser key", async () => {
    await writeFile(configPath, `${JSON.stringify({ askUser: "yes" }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config askUser must be a boolean");
  });

  it("rejects upload defaults that are not workspace-relative", async () => {
    await writeFile(configPath, `${JSON.stringify({ uploads: { defaultFolder: "../outside" } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config uploads.defaultFolder must not contain path traversal");
  });
});

describe("maxUploadBytes", () => {
  it("defaults when nothing is configured", () => {
    expect(maxUploadBytes({}, {})).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it("prefers the env override over config", () => {
    expect(maxUploadBytes({ PI_WEB_MAX_UPLOAD_BYTES: "2048" }, { maxUploadBytes: 99 })).toBe(2048);
  });

  it("falls back to config when env is unset or invalid", () => {
    expect(maxUploadBytes({ PI_WEB_MAX_UPLOAD_BYTES: "not-a-number" }, { maxUploadBytes: 555 })).toBe(555);
  });
});

describe("extensionDialogsTimeoutMs", () => {
  it("defaults to five minutes when nothing is configured", () => {
    expect(effectivePiWebConfig(testOptions()).config.extensionDialogsTimeoutMs).toBe(DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS);
  });

  it("resolves a configured value, including zero for waiting forever", async () => {
    await writeFile(configPath, `${JSON.stringify({ extensionDialogsTimeoutMs: 0 }, null, 2)}\n`, "utf8");

    expect(effectivePiWebConfig(testOptions()).config.extensionDialogsTimeoutMs).toBe(0);
  });
});

describe("spawnSessionsEnabled", () => {
  it("is on by default when nothing is configured", () => {
    expect(spawnSessionsEnabled({}, {})).toBe(true);
  });

  it("honors an explicit config opt-out", () => {
    expect(spawnSessionsEnabled({}, { spawnSessions: false })).toBe(false);
  });

  it("lets the env var override the config in both directions", () => {
    expect(spawnSessionsEnabled({ PI_WEB_SPAWN_SESSIONS: "0" }, { spawnSessions: true })).toBe(false);
    expect(spawnSessionsEnabled({ PI_WEB_SPAWN_SESSIONS: "1" }, { spawnSessions: false })).toBe(true);
  });
});

describe("subsessionsEnabled", () => {
  it("is on by default", () => {
    expect(subsessionsEnabled({}, {})).toBe(true);
  });

  it("honors an explicit config opt-out", () => {
    expect(subsessionsEnabled({}, { subsessions: false })).toBe(false);
  });

  it("lets the env var override the config in both directions", () => {
    expect(subsessionsEnabled({ PI_WEB_SUBSESSIONS: "1" }, { subsessions: false })).toBe(true);
    expect(subsessionsEnabled({ PI_WEB_SUBSESSIONS: "0" }, { subsessions: true })).toBe(false);
  });
});

describe("askUserEnabled", () => {
  it("is on by default because the user is present for every ask", () => {
    expect(askUserEnabled({}, {})).toBe(true);
  });

  it("honors an explicit config opt-out", () => {
    expect(askUserEnabled({}, { askUser: false })).toBe(false);
  });

  it("lets the env var override the config in both directions", () => {
    expect(askUserEnabled({ PI_WEB_ASK_USER: "0" }, { askUser: true })).toBe(false);
    expect(askUserEnabled({ PI_WEB_ASK_USER: "true" }, { askUser: false })).toBe(true);
  });

  it("treats an empty env value as unset", () => {
    expect(askUserEnabled({ PI_WEB_ASK_USER: "" }, { askUser: false })).toBe(false);
  });
});

describe("offlineModeEnabled", () => {
  it("is off when no offline env var is set", () => {
    expect(offlineModeEnabled({})).toBe(false);
  });

  it("treats an empty value as unset", () => {
    expect(offlineModeEnabled({ PI_OFFLINE: "", PI_WEB_OFFLINE: "" })).toBe(false);
  });

  it("is on when either offline key has a value", () => {
    expect(offlineModeEnabled({ PI_OFFLINE: "1" })).toBe(true);
    expect(offlineModeEnabled({ PI_WEB_OFFLINE: "anything" })).toBe(true);
  });

  it("ignores the narrower skip-version-check keys", () => {
    expect(offlineModeEnabled({ PI_SKIP_VERSION_CHECK: "1", PI_WEB_SKIP_VERSION_CHECK: "1" })).toBe(false);
  });
});

function testOptions(): { env: NodeJS.ProcessEnv } {
  return { env: { PI_WEB_CONFIG: configPath } };
}
