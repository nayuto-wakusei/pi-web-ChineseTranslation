import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Start the published entry points outside the checkout so dev dependencies cannot mask missing runtime packages.
// Pi 0.85.0 imports undeclared pi-server; our explicit runtime dependency (and narrow Knip exception) supplies it.
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
