import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const STARTUP_PROJECT = "Startup benchmark workspace";
export const STARTUP_MESSAGE = "Synthetic startup benchmark message";
const SESSION_ID = "019ef4c0-0000-7000-8000-000000000002";

export async function startStartupFixture() {
  const dist = resolve("dist");
  const root = await mkdtemp(join(tmpdir(), "pi-web-startup-"));
  const children = [];
  const close = async () => {
    await Promise.all(children.map(({ child, closed }) => {
      child.kill();
      return closed;
    }));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  };
  try {
    const sessionDir = join(root, "sessions");
    const config = join(root, "config.json");
    await mkdir(sessionDir);
    const [port, daemonPort] = await availablePorts();
    const origin = `http://127.0.0.1:${port}`;
    const daemon = `http://127.0.0.1:${daemonPort}`;
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PI_|PORT$|NODE_OPTIONS$|XDG_|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$)/iu.test(key))),
      NODE_ENV: "production",
      HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
      XDG_CONFIG_HOME: join(root, "config"),
      PI_WEB_CONFIG: config,
      PI_WEB_DATA_DIR: join(root, "data"),
      PI_WEB_SESSIOND_PORT: String(daemonPort),
      PI_WEB_SESSIOND_URL: daemon,
      PI_CODING_AGENT_DIR: join(root, "agent"),
      PI_CODING_AGENT_SESSION_DIR: sessionDir,
      PI_WEB_OFFLINE: "1",
    };
    await writeFile(config, JSON.stringify({ host: "127.0.0.1", port }));
    const start = (entry) => {
      const child = spawn(process.execPath, [join(dist, "server", entry)], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      const state = { child, problem: "", stderr: "", closed: new Promise((done) => child.once("close", done)) };
      children.push(state);
      child.on("error", (error) => { state.problem = error.message; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { state.stderr = (state.stderr + chunk).slice(-3000); });
      return state;
    };
    await waitFor(`${daemon}/health`, start("sessiond.js"), (data) => data.ok === true);
    await waitFor(`${origin}/api/normal-auth/status`, start("index.js"), (data) => data.configured === false);
    const setup = await request(`${origin}/api/normal-auth/setup`, { password: "isolated-startup-fixture-password" });
    const cookie = setup.headers.getSetCookie().find((entry) => entry.startsWith("pi_web_normal_session="))?.split(";")[0];
    if (!cookie) throw new Error("Fixture setup did not create a browser session");
    const health = await (await request(`${origin}/api/sessiond/health`, undefined, { cookie })).json();
    if (health.ok !== true) throw new Error("Gateway did not report a healthy daemon");

    const register = async (directory, name) => {
      const path = join(root, directory);
      await mkdir(path);
      const project = await (await request(`${daemon}/projects`, { path, name })).json();
      const catalog = await (await request(`${origin}/api/projects/${encodeURIComponent(project.id)}/workspaces`, undefined, { cookie })).json();
      const workspace = catalog.workspaces?.[0];
      if (!workspace) throw new Error("Fixture project did not expose its workspace");
      const url = new URL(origin);
      url.searchParams.set("project", project.id);
      url.searchParams.set("workspace", workspace.id);
      return { url, workspace };
    };
    const { url: projectUrl } = await register("empty-project", STARTUP_PROJECT);
    const { url: sessionUrl, workspace } = await register("session-project", "Startup benchmark chat");
    const timestamp = "2026-01-01T00:00:00.000Z";
    const entries = [
      { type: "session", version: 3, id: SESSION_ID, timestamp, cwd: workspace.path },
      { type: "message", id: "a1000001", parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: STARTUP_MESSAGE }], timestamp: Date.parse(timestamp) } },
    ];
    await writeFile(join(sessionDir, `${timestamp.replaceAll(":", "-")}_${SESSION_ID}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    sessionUrl.searchParams.set("session", SESSION_ID);
    sessionUrl.searchParams.set("view", "chat");
    return { origin, projectUrl: projectUrl.href, sessionUrl: sessionUrl.href, cookie, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function availablePorts() {
  const servers = [createServer(), createServer()];
  try {
    for (const server of servers) {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
    }
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.filter((server) => server.listening).map((server) => new Promise((done) => server.close(done))));
  }
}

async function request(url, body, headers = {}) {
  const response = await fetch(url, {
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
  return response;
}

async function waitFor(url, state, validate) {
  const end = Date.now() + 20_000;
  let failure;
  while (Date.now() < end && !state.problem && state.child.exitCode === null && state.child.signalCode === null) {
    try {
      if (validate(await (await request(url)).json())) return;
      failure = "unexpected response";
    } catch (error) {
      failure = error.message;
    }
    await delay(100);
  }
  throw new Error(`Fixture not ready at ${url}: ${state.problem || failure || "process exited"}\n${state.stderr}`);
}
