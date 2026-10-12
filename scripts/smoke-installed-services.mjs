import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Start the published entry points outside the checkout so dev dependencies cannot mask missing runtime packages.
export async function smokeInstalledServices(packageRoot) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-service-smoke-"));
  const processes = [];
  try {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    const daemonPort = await unusedPort();
    let webPort = await unusedPort();
    while (webPort === daemonPort) webPort = await unusedPort();
    const home = join(root, "home");
    await mkdir(home);
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ host: "127.0.0.1", port: webPort }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith("PI_WEB_") && !key.startsWith("PI_CODING_AGENT_") && key !== "NODE_PATH" && key !== "NODE_OPTIONS"));
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PI_WEB_CONFIG: configPath,
      PI_WEB_DATA_DIR: join(root, "data"),
      PI_WEB_AGENT_DIR: join(root, "agent"),
      PI_WEB_SESSIOND_PORT: String(daemonPort),
      PI_WEB_SESSIOND_HOST: "127.0.0.1",
      PI_WEB_SESSIOND_URL: `http://127.0.0.1:${daemonPort}`,
    });
    processes.push(start("sessiond", join(packageRoot, "dist", "server", "sessiond.js"), root, env));
    const health = await waitForJson(`http://127.0.0.1:${daemonPort}/health`, processes);
    if (health.ok !== true || health.version?.runtimeVersion !== manifest.version) {
      throw new Error(`Unexpected installed daemon health: ${JSON.stringify(health)}`);
    }
    const expectedPiVersion = manifest.devDependencies["@earendil-works/pi-coding-agent"];
    if (health.version.piVersion !== expectedPiVersion) {
      throw new Error(`Installed daemon loaded Pi ${health.version.piVersion}; expected tested SDK ${expectedPiVersion}`);
    }
    processes.push(start("web", join(packageRoot, "dist", "server", "index.js"), root, env));
    const webUrl = `http://127.0.0.1:${webPort}`;
    await waitForJson(`${webUrl}/api/normal-auth/status`, processes);
    const setup = await fetch(`${webUrl}/api/normal-auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "isolated-package-smoke-password" }),
      signal: AbortSignal.timeout(5_000),
    });
    const cookie = setup.headers.get("set-cookie")?.split(";")[0];
    if (!setup.ok || !cookie) throw new Error(`Installed web auth setup failed: HTTP ${setup.status}`);
    const status = await waitForJson(`${webUrl}/api/pi-web/version`, processes, { cookie });
    for (const name of ["web", "sessiond"]) {
      const component = status.components?.[name];
      if (component?.available !== true || component.runtimeVersion !== manifest.version || component.piVersion !== expectedPiVersion) {
        throw new Error(`Installed ${name} is unavailable or mismatched: ${JSON.stringify(status)}`);
      }
    }
    await smokeDaemonTerminal(packageRoot, root, webUrl, cookie);
    const web = processes.find((entry) => entry.name === "web");
    web.child.kill("SIGTERM");
    await web.done;
    const survivingDaemon = await waitForJson(`http://127.0.0.1:${daemonPort}/health`, processes.filter((entry) => entry.name === "sessiond"));
    if (survivingDaemon.ok !== true) throw new Error("Daemon did not survive the web shutdown");
    console.log("Installed Terminal gateway request/channel, command completion and daemon ownership passed.");
    console.log(`Installed web and daemon startup passed (${manifest.version}, Pi ${health.version.piVersion}).`);
  } catch (error) {
    throw new Error(`${String(error)}\n${processes.map((entry) => `${entry.name}:\n${entry.output}`).join("\n")}`, { cause: error });
  } finally {
    for (const entry of processes.reverse()) {
      if (!entry.closed) entry.child.kill("SIGTERM");
      const forceKill = setTimeout(() => entry.child.kill("SIGKILL"), 5_000);
      await entry.done;
      clearTimeout(forceKill);
    }
    await rm(root, { recursive: true, force: true });
  }
}

async function smokeDaemonTerminal(packageRoot, root, webUrl, cookie) {
  const headers = { cookie, "content-type": "application/json" };
  async function json(path, body) {
    const response = await fetch(`${webUrl}/${path}`, {
      headers, signal: AbortSignal.timeout(10_000),
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(result)}`);
    return result;
  }
  const manifest = await json("pi-web-plugins/manifest.json");
  const terminal = manifest.plugins?.find((entry) => entry.id === "pi-web.terminal");
  if (manifest.lifecycleVersion !== 2 || manifest.terminalMode !== "required" || !terminal?.backendRevision
    || terminal.pairedRequestVersion !== 1 || terminal.pairedChannelVersion !== 1 || terminal.machineSpecific !== true) {
    throw new Error(`Required Terminal manifest is not paired: ${JSON.stringify(manifest)}`);
  }
  const workspaceRoot = join(root, "terminal-workspace");
  await mkdir(workspaceRoot);
  const project = await json("api/machines/local/projects", { path: workspaceRoot, name: "Terminal package smoke" });
  const listing = await json(`api/machines/local/projects/${encodeURIComponent(project.id)}/workspaces`);
  if (!Array.isArray(listing.workspaces)) throw new Error(`Installed workspace listing is invalid: ${JSON.stringify(listing)}`);
  const workspace = listing.workspaces.find((entry) => entry.isMain);
  if (!workspace?.id) throw new Error("Installed Terminal workspace is missing");
  const base = `api/paired-plugin-backends/pi-web.terminal/projects/${encodeURIComponent(project.id)}/workspaces/${encodeURIComponent(workspace.id)}`;
  const request = (operation, input) => json(`${base}/${operation}`, { revision: terminal.backendRevision, input });
  const marker = "INSTALLED_TERMINAL_DAEMON_PEER_OK";
  const run = await request("terminal.run", { origin: "package-smoke", title: "Native daemon PTY", command: `printf '%s' '${marker}'` });
  if (!run?.id || !run.terminalId) throw new Error("Installed Terminal run did not return identifiers");
  const { WebSocket } = createRequire(join(packageRoot, "package.json"))("ws");
  const socket = new WebSocket(`${webUrl.replace(/^http/, "ws")}/${base}/channels/terminal.attach`, { headers: { cookie } });
  let output = "";
  try {
    await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Installed Terminal channel timed out: ${JSON.stringify(output)}`)), 10_000);
      const fail = (error) => { clearTimeout(timeout); reject(error); };
      socket.once("error", fail);
      socket.once("open", () => socket.send(JSON.stringify({ version: 1, kind: "open", revision: terminal.backendRevision, input: { terminalId: run.terminalId } })));
      socket.on("message", (data) => {
        try {
          const frame = JSON.parse(data.toString());
          if (frame.kind === "error") throw new Error(`Installed Terminal channel: ${frame.code}: ${frame.message}`);
          if (frame.kind !== "data") return;
          if (frame.data.type === "output") output += frame.data.data;
          if (frame.data.type === "exit") {
            if (frame.data.exitCode !== 0 || !output.includes(marker)) throw new Error(`Native daemon Terminal failed: ${JSON.stringify(frame)}, ${JSON.stringify(output)}`);
            clearTimeout(timeout);
            resolvePromise();
          }
        } catch (error) { fail(error); }
      });
    });
    const completed = await request("terminal.get-run", { runId: run.id });
    if (completed.status !== "succeeded") throw new Error(`Terminal command did not complete: ${JSON.stringify(completed)}`);
  } finally {
    socket.terminate();
    await request("terminal.close", { terminalId: run.terminalId });
  }
}

function start(name, path, cwd, env) {
  const child = spawn(process.execPath, [path], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const entry = { name, child, output: "", closed: false, done: undefined };
  const collect = (data) => { entry.output = (entry.output + data.toString()).slice(-64 * 1024); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", (error) => collect(String(error)));
  entry.done = new Promise((resolve) => child.once("close", () => { entry.closed = true; resolve(); }));
  return entry;
}

async function waitForJson(url, processes, headers = {}) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (processes.some((entry) => entry.closed)) throw new Error("Installed service exited before becoming ready");
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(2_000) });
    } catch (error) {
      lastError = error;
    }
    if (response) {
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      return await response.json();
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
