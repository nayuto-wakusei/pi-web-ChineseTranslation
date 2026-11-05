import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilePiWebConfigService, parsePiWebConfigResponseBody, registerConfigRoutes, registerLocalMachineConfigRoutes } from "./configRoutes.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";
import { loadPiWebConfig } from "../config.js";

let app: FastifyInstance;
let directory: string;
let writable: string;
let defaults: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-web-config-architecture-"));
  writable = join(directory, "config.json");
  defaults = join(directory, "defaults.json");
});

afterEach(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

function start(env: NodeJS.ProcessEnv = {}, readWriteOnly = false): void {
  app = Fastify({ logger: false });
  const fileService = createFilePiWebConfigService({ env: { PI_WEB_CONFIG: writable, PI_WEB_DEFAULTS_CONFIG: defaults, ...env } });
  const service = readWriteOnly ? { read: fileService.read, write: fileService.write } : fileService;
  registerConfigRoutes(app, service);
  registerLocalMachineConfigRoutes(app, service);
}

describe("layered config updates", () => {
  it("preserves the direct key when the application wraps config as a read/write-only service", async () => {
    writeFileSync(defaults, "{}");
    writeFileSync(writable, JSON.stringify({ speech: { apiKey: "wrapped-test-key" } }));
    start({}, true);
    const result = await app.inject({ method: "PUT", url: "/api/config", payload: { config: { askUser: false } } });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain("wrapped-test-key");
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ askUser: false, speech: { apiKey: "wrapped-test-key" } });
  });

  it.each(["/api/config", "/api/machines/local/config"])("stores, redacts, preserves and explicitly clears speech keys through %s", async (url) => {
    writeFileSync(defaults, JSON.stringify({ speech: { apiKey: "deployment-test-key" } }));
    writeFileSync(writable, JSON.stringify({ speech: { apiKeyEnv: "SPEECH_TOKEN" } }));
    start();
    const stored = (): PiWebConfigValues => loadPiWebConfig({ env: { PI_WEB_CONFIG: writable } }).config;
    const checkRedacted = (body: string) => {
      expect(body).not.toContain("deployment-test-key");
      expect(body).not.toContain("saved-test-key");
      return parsePiWebConfigResponseBody(JSON.parse(body));
    };

    const initial = await app.inject({ method: "GET", url });
    expect(checkRedacted(initial.body).speechApiKeyPresence).toEqual({ config: false, effectiveConfig: true, defaultsConfig: true });
    const absentKey = await app.inject({ method: "GET", url: `${url}/speech-api-key` });
    expect(absentKey.json()).toEqual({ apiKey: "" });
    expect(absentKey.headers["cache-control"]).toBe("no-store");
    const saved = await app.inject({ method: "PATCH", url, payload: { set: { speech: { apiKey: "saved-test-key" } } } });
    expect(saved.statusCode).toBe(200);
    expect(stored().speech?.apiKey).toBe("saved-test-key");
    expect(checkRedacted(saved.body).speechApiKeyPresence).toEqual({ config: true, effectiveConfig: true, defaultsConfig: true });
    const privateRead = await app.inject({ method: "GET", url: `${url}/speech-api-key` });
    expect(privateRead.statusCode).toBe(200);
    expect(privateRead.json()).toEqual({ apiKey: "saved-test-key" });
    expect(privateRead.headers["cache-control"]).toBe("no-store");

    const changed = await app.inject({ method: "PATCH", url, payload: { set: { speech: { model: "asr" } } } });
    expect(changed.statusCode).toBe(200);
    checkRedacted(changed.body);
    expect(stored().speech).toEqual({ apiKey: "saved-test-key", apiKeyEnv: "SPEECH_TOKEN", model: "asr" });
    const roundtrip = await app.inject({ method: "PUT", url, payload: { config: checkRedacted(changed.body).config } });
    expect(roundtrip.statusCode).toBe(200);
    checkRedacted(roundtrip.body);
    expect(stored().speech?.apiKey).toBe("saved-test-key");

    const cleared = await app.inject({ method: "PATCH", url, payload: { unset: ["/speech/apiKey"] } });
    expect(cleared.statusCode).toBe(200);
    expect(stored().speech?.apiKey).toBeUndefined();
    expect(checkRedacted(cleared.body).speechApiKeyPresence).toEqual({ config: false, effectiveConfig: true, defaultsConfig: true });
    expect(readFileSync(defaults, "utf8")).toContain("deployment-test-key");
  });

  it("protects environment-enforced direct keys and saved hidden overrides", async () => {
    writeFileSync(defaults, "{}");
    writeFileSync(writable, JSON.stringify({ speech: { apiKey: "hidden-test-key" } }));
    start({ PI_WEB_SPEECH: JSON.stringify({ apiKey: "enforced-test-key" }) });
    const url = "/api/config";
    const read = await app.inject({ method: "GET", url });
    expect(read.body).not.toContain("hidden-test-key");
    expect(read.body).not.toContain("enforced-test-key");
    expect(read.json<PiWebConfigResponse>().enforcedSettings).toMatchObject({ "/speech/apiKey": "PI_WEB_SPEECH" });
    for (const payload of [{ set: { speech: { apiKey: "replacement" } } }, { unset: ["/speech/apiKey"] }, { unset: ["/speech"] }]) {
      const rejected = await app.inject({ method: "PATCH", url, payload });
      expect(rejected.statusCode).toBe(400);
    }
    const replaced = await app.inject({ method: "PUT", url, payload: { config: { speech: { model: "asr" } } } });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.body).not.toContain("hidden-test-key");
    expect(replaced.body).not.toContain("enforced-test-key");
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ speech: { model: "asr", apiKey: "hidden-test-key" } });
  });

  it.each(["/api/config", "/api/machines/local/config"])("rejects legacy core sessionNaming updates through %s without touching persistence", async (url) => {
    const deployment = JSON.stringify({ uploads: { defaultFolder: "deployed" } });
    const saved = JSON.stringify({ askUser: false });
    writeFileSync(defaults, deployment);
    writeFileSync(writable, saved);
    start();
    for (const [method, payload] of [
      ["PUT", { config: { sessionNaming: { model: "provider/model" } } }],
      ["PATCH", { set: { sessionNaming: {} } }],
      ["PATCH", { unset: ["/sessionNaming"] }],
    ] as const) {
      const result = await app.inject({ method, url, payload });
      expect(result.statusCode).toBe(400);
      expect(readFileSync(writable, "utf8")).toBe(saved);
      expect(readFileSync(defaults, "utf8")).toBe(deployment);
    }
  });

  it("resets sessionMessages to deployment defaults without persisting effective values", async () => {
    writeFileSync(defaults, JSON.stringify({ sessionMessages: false }));
    writeFileSync(writable, JSON.stringify({ spawnSessions: false, subsessions: false }));
    start();
    const url = "/api/machines/local/config";
    const saved = await app.inject({ method: "PATCH", url, payload: { set: { sessionMessages: true } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<PiWebConfigResponse>().effectiveConfig.sessionMessages).toBe(true);
    const reset = await app.inject({ method: "PATCH", url, payload: { unset: ["/sessionMessages"] } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<PiWebConfigResponse>()).toMatchObject({ effectiveConfig: { sessionMessages: false }, configSources: { "/sessionMessages": "defaults" } });
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ spawnSessions: false, subsessions: false });
  });

  it("enforces sessionMessages while preserving the hidden saved choice", async () => {
    writeFileSync(defaults, "{}");
    writeFileSync(writable, JSON.stringify({ sessionMessages: true }));
    start({ PI_WEB_SESSION_MESSAGES: "false" });
    const url = "/api/machines/local/config";
    const read = await app.inject({ method: "GET", url });
    expect(parsePiWebConfigResponseBody(read.json())).toMatchObject({
      config: { sessionMessages: true }, effectiveConfig: { sessionMessages: false },
      envOverrides: { sessionMessages: true }, enforcedSettings: { "/sessionMessages": "PI_WEB_SESSION_MESSAGES" },
      configSources: { "/sessionMessages": "PI_WEB_SESSION_MESSAGES" },
    });
    for (const payload of [{ set: { sessionMessages: false } }, { unset: ["/sessionMessages"] }]) {
      const rejected = await app.inject({ method: "PATCH", url, payload });
      expect(rejected.statusCode).toBe(400);
    }
    const replaced = await app.inject({ method: "PUT", url, payload: { config: { spawnSessions: false } } });
    expect(replaced.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ sessionMessages: true, spawnSessions: false });
  });

  it.each(["/api/config", "/api/machines/local/config"])("protects hidden overrides during legacy PUT through %s", async (url) => {
    writeFileSync(defaults, "{}");
    const saved = { installationName: "Hidden", attachments: { defaultFolder: "hidden" }, uploads: { defaultFolder: "ordinary" }, askUser: false, quietMode: true };
    writeFileSync(writable, JSON.stringify(saved));
    start({ PI_WEB_INSTALLATION_NAME: "Enforced", PI_WEB_ATTACHMENTS: '{"defaultFolder":"enforced"}' });
    const read = await app.inject({ method: "GET", url });
    const roundtrip = await app.inject({ method: "PUT", url, payload: { config: read.json<PiWebConfigResponse>().config } });
    expect(roundtrip.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual(saved);
    for (const config of [{ installationName: "New" }, { attachments: { defaultFolder: "new" } }]) {
      const rejected = await app.inject({ method: "PUT", url, payload: { config } });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json<{ error: string }>().error).toContain("enforced by");
      expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual(saved);
    }
    const result = await app.inject({ method: "PUT", url, payload: { config: { uploads: { defaultFolder: "updated" } } } });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({
      ...(url === "/api/config" ? {} : { askUser: false, quietMode: true }),
      installationName: "Hidden", attachments: { defaultFolder: "hidden" }, uploads: { defaultFolder: "updated" },
    });
    expect(result.json<PiWebConfigResponse>().effectiveConfig).toMatchObject({ installationName: "Enforced", attachments: { defaultFolder: "enforced" }, uploads: { defaultFolder: "updated" } });
  });

  it.each(["/api/config", "/api/machines/local/config"])("does not materialize absent enforced saved settings through %s", async (url) => {
    writeFileSync(defaults, "{}");
    writeFileSync(writable, "{}");
    start({ PI_WEB_INSTALLATION_NAME: "Enforced", PI_WEB_ATTACHMENTS: '{"defaultFolder":"enforced"}' });
    const result = await app.inject({ method: "PUT", url, payload: { config: { uploads: { defaultFolder: "personal" } } } });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ uploads: { defaultFolder: "personal" } });
  });

  it("saves and resets in one request without copying defaults or modifying the defaults file", async () => {
    const deployment = { installationName: "Office", quietMode: true, uploads: { defaultFolder: "deployment" } };
    writeFileSync(defaults, JSON.stringify(deployment));
    writeFileSync(writable, JSON.stringify({ installationName: "Personal", extensionDialogsTimeoutMs: 0, environmentFacts: false }));
    start();
    const result = await app.inject({ method: "PATCH", url: "/api/config", payload: { set: { quietMode: false }, unset: ["/installationName"] } });
    expect(result.statusCode).toBe(200);
    const response = parsePiWebConfigResponseBody(result.json());
    expect(response.effectiveConfig).toMatchObject({ installationName: "Office", quietMode: false, extensionDialogsTimeoutMs: 0, environmentFacts: false });
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ quietMode: false, extensionDialogsTimeoutMs: 0, environmentFacts: false });
    expect(JSON.parse(readFileSync(defaults, "utf8"))).toEqual(deployment);
    expect(response.defaultsPath).toBe(defaults);
    expect(response.defaultsConfig).toEqual(deployment);
  });

  it("updates namespace leaves independently and resets escaped plugin keys", async () => {
    writeFileSync(defaults, JSON.stringify({ defaultLocalization: { language: "en", timeZone: "UTC" }, plugins: { git: { settings: { options: { one: true } } } } }));
    writeFileSync(writable, JSON.stringify({ plugins: { git: { enabled: false, settings: { "a/b": [1], options: {} } } }, defaultLocalization: { language: "fr" } }));
    start();
    const result = await app.inject({ method: "PATCH", url: "/api/config", payload: { set: { defaultLocalization: { hourCycle: "h12" } }, unset: ["/plugins/git/settings/a~1b"] } });
    expect(result.statusCode).toBe(200);
    expect(result.json<PiWebConfigResponse>().effectiveConfig).toMatchObject({ defaultLocalization: { language: "fr", timeZone: "UTC", hourCycle: "h12" }, plugins: { git: { enabled: false, settings: { options: {} } } } });
    expect(result.json<PiWebConfigResponse>().config.plugins?.["git"]?.settings).not.toHaveProperty("a/b");
  });

  it("rejects policy writes but preserves hidden values on unrelated saves", async () => {
    writeFileSync(defaults, "{}");
    writeFileSync(writable, JSON.stringify({ installationName: "Personal" }));
    start({ PI_WEB_INSTALLATION_NAME: "Enforced" });
    const rejected = await app.inject({ method: "PATCH", url: "/api/config", payload: { unset: ["/installationName"] } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json<{ error: string }>().error).toContain("PI_WEB_INSTALLATION_NAME");
    const result = await app.inject({ method: "PATCH", url: "/api/config", payload: { set: { quietMode: true } } });
    expect(result.statusCode).toBe(200);
    expect(result.json<PiWebConfigResponse>().config.installationName).toBe("Personal");
    expect(result.json<PiWebConfigResponse>().effectiveConfig.installationName).toBe("Enforced");
    expect(result.json<PiWebConfigResponse>().enforcedSettings).toMatchObject({ "/installationName": "PI_WEB_INSTALLATION_NAME" });
  });

  it.each([
    { set: { quietMode: false }, unset: ["/quietMode"] },
    { set: { quietMode: true }, unset: ["/unknown"] },
    { set: { quietMode: "false" } },
    { set: { typo: true } },
    { unset: null },
    { unset: ["/uploads/unknown"] },
  ])("rejects an invalid complete update before writing: %j", async (payload) => {
    writeFileSync(defaults, "{}");
    writeFileSync(writable, "{}");
    start();
    const result = await app.inject({ method: "PATCH", url: "/api/config", payload });
    expect(result.statusCode).toBe(400);
    expect(readFileSync(writable, "utf8")).toBe("{}");
  });

  it("saves and resets independent localization fields without touching enforced siblings", async () => {
    writeFileSync(defaults, JSON.stringify({ defaultLocalization: { language: "en", timeZone: "UTC", formatLocale: "de-DE" } }));
    writeFileSync(writable, JSON.stringify({ defaultLocalization: { language: "fr", timeZone: "Europe/Paris" } }));
    start({ PI_WEB_DEFAULT_LOCALIZATION: '{"language":"de"}' });
    const saved = await app.inject({ method: "PATCH", url: "/api/config", payload: { set: { defaultLocalization: { timeZone: "Europe/Berlin" } } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<PiWebConfigResponse>().effectiveConfig.defaultLocalization).toEqual({ language: "de", timeZone: "Europe/Berlin", formatLocale: "de-DE" });
    expect(saved.json<PiWebConfigResponse>().config.defaultLocalization).toEqual({ language: "fr", timeZone: "Europe/Berlin" });
    expect(saved.json<PiWebConfigResponse>().enforcedSettings).toEqual({ "/defaultLocalization/language": "PI_WEB_DEFAULT_LOCALIZATION" });
    const reset = await app.inject({ method: "PATCH", url: "/api/config", payload: { unset: ["/defaultLocalization/timeZone"] } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<PiWebConfigResponse>().effectiveConfig.defaultLocalization).toEqual({ language: "de", timeZone: "UTC", formatLocale: "de-DE" });
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ defaultLocalization: { language: "fr" } });
    const rejected = await app.inject({ method: "PATCH", url: "/api/config", payload: { unset: ["/defaultLocalization"] } });
    expect(rejected.statusCode).toBe(400);
  });

  it("inherits through empty folder containers and resets a leaf to deployment defaults", async () => {
    writeFileSync(defaults, JSON.stringify({ uploads: { defaultFolder: "deployment" }, attachments: { defaultFolder: "deployed-attachments" } }));
    writeFileSync(writable, JSON.stringify({ uploads: {}, attachments: {} }));
    start({ PI_WEB_UPLOADS: "{}" });
    const initial = await app.inject({ method: "GET", url: "/api/config" });
    expect(initial.json<PiWebConfigResponse>().effectiveConfig.uploads).toEqual({ defaultFolder: "deployment" });
    expect(initial.json<PiWebConfigResponse>().enforcedSettings).toEqual({});
    const saved = await app.inject({ method: "PATCH", url: "/api/config", payload: { set: { uploads: { defaultFolder: "personal" } } } });
    expect(saved.statusCode).toBe(200);
    const reset = await app.inject({ method: "PATCH", url: "/api/config", payload: { unset: ["/uploads/defaultFolder"] } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<PiWebConfigResponse>().effectiveConfig.uploads).toEqual({ defaultFolder: "deployment" });
    expect(reset.json<PiWebConfigResponse>().config).not.toHaveProperty("uploads");
  });

  it("retains selected-machine isolation and supports machine override removal", async () => {
    writeFileSync(defaults, JSON.stringify({ installationName: "Office", defaultTheme: { themeId: "themes:pi-web-dark", auto: false } }));
    writeFileSync(writable, JSON.stringify({ host: "localhost", installationName: "Personal" }));
    start({ PI_WEB_HOST: "127.0.0.1" });
    const rejected = await app.inject({ method: "PATCH", url: "/api/machines/local/config", payload: { unset: ["/host"] } });
    expect(rejected.statusCode).toBe(400);
    const result = await app.inject({ method: "PATCH", url: "/api/machines/local/config", payload: { unset: ["/installationName"] } });
    expect(result.statusCode).toBe(200);
    const response = result.json<PiWebConfigResponse>();
    expect(response.effectiveConfig.installationName).toBe("Office");
    expect(response.defaultsConfig).not.toHaveProperty("defaultTheme");
    expect(response.enforcedSettings).not.toHaveProperty("/host");
    expect(JSON.parse(readFileSync(writable, "utf8"))).toEqual({ host: "localhost" });
  });
});
