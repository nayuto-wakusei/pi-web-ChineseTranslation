import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import dictionary from "../../../pi-web-plugins/zh-cn/machines.json";
import { createTranslator } from "../../shared/i18n.js";
import { RemoteMachineClient, type MachineClient } from "./machineClient.js";
import { registerMachineRoutes } from "./machineRoutes.js";
import { registerMachineProxyRoutes } from "./machineProxyRoutes.js";
import { registerMachinePluginProxyRoutes } from "./machinePluginProxyRoutes.js";
import { MachineService } from "./machineService.js";
import { MachineStore } from "./machineStore.js";

const apps: FastifyInstance[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(locale: string, client?: MachineClient) {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-machine-localization-"));
  directories.push(directory);
  const t = createTranslator(locale, dictionary);
  const machines = new MachineService(new MachineStore(join(directory, "machines.json")), {
    translate: t,
    ...(client === undefined ? {} : { remoteClientFactory: () => client }),
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(websocket);
  registerMachineRoutes(app, machines, undefined, t);
  registerMachineProxyRoutes(app, machines, undefined, t);
  registerMachinePluginProxyRoutes(app, machines, t);
  return { app, machines };
}

function remoteClient(payload: unknown): MachineClient {
  return {
    request: () => Promise.resolve({ statusCode: 503, headers: { "content-type": "application/json" }, body: Readable.from([JSON.stringify(payload)]) }),
    requestJson: () => Promise.resolve({ statusCode: 503, headers: {}, body: payload }),
    connectWebSocket: () => { throw new Error("Unused test socket"); },
  };
}

describe("machine localization boundaries", () => {
  it("localizes its own timeout detail without rewriting network failures", async () => {
    const t = createTranslator("zh-CN", dictionary);
    const timeout = new RemoteMachineClient({ baseUrl: "https://remote.test" }, (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(new DOMException("aborted", "AbortError")); }, { once: true });
    }), t);
    await expect(timeout.requestJson("GET", "/api/projects", undefined, { timeoutMs: 1 })).rejects.toMatchObject({ statusCode: 504, message: "远程机器请求超时" });
    const network = new RemoteMachineClient({ baseUrl: "https://remote.test" }, () => Promise.reject(new Error("raw network detail")), t);
    await expect(network.requestJson("GET", "/api/projects")).rejects.toMatchObject({ statusCode: 502, message: "raw network detail" });
  });

  it.each([
    ["en", "Machine name is required", "Machine not found", "Machine header is not allowed: Cookie"],
    ["zh-CN", "必须填写机器名称", "找不到机器", "不允许使用机器请求头：Cookie"],
  ])("localizes owned validation and missing-machine errors in %s", async (locale, required, missing, header) => {
    const { app } = await fixture(locale);
    const invalid = await app.inject({ method: "POST", url: "/api/machines", payload: {} });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: required });
    const absent = await app.inject("/api/machines/missing");
    expect(absent.statusCode).toBe(404);
    expect(absent.json()).toEqual({ error: missing });
    const forbidden = await app.inject({ method: "POST", url: "/api/machines", payload: { name: "服务器", baseUrl: "https://example.test", headers: { Cookie: "private" } } });
    expect(forbidden.statusCode).toBe(400);
    expect(forbidden.json()).toEqual({ error: header });
  });

  it("preserves remote API and plugin error bodies even when matching owned English copy", async () => {
    const payload = { error: "Machine not found", detail: "远端原文 {status}" };
    const { app, machines } = await fixture("zh-CN", remoteClient(payload));
    const remote = await machines.add({ name: "User supplied 名称", baseUrl: "https://remote.test" });
    const response = await app.inject(`/api/machines/${remote.id}/projects`);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(payload);
    const manifest = await app.inject(`/api/machines/${remote.id}/pi-web-plugins/manifest.json`);
    expect(manifest.statusCode).toBe(503);
    expect(manifest.json()).toEqual(payload);
    expect((await machines.get(remote.id))?.name).toBe("User supplied 名称");
  });

  it.each([
    ["en", "Remote health returned HTTP 503", "Remote runtime returned HTTP 503"],
    ["zh-CN", "远程健康检查返回 HTTP 503", "远程运行时检查返回 HTTP 503"],
  ])("uses the gateway translator for owned health summaries in %s", async (locale, health, runtime) => {
    const { machines } = await fixture(locale, remoteClient({ error: "remote error" }));
    const remote = await machines.add({ name: "Remote", baseUrl: "https://remote.test" });
    expect(await machines.health(remote.id)).toMatchObject({ machineId: remote.id, status: "error", error: health });
    expect(await machines.runtime(remote.id)).toMatchObject({ machineId: remote.id, ok: false, error: runtime });
  });
});
