import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const exec = promisify(execFile);
let server;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });

async function target(handler) {
  server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}/health`;
}

it("reports HTTP and generator metrics separately and validates business JSON", async () => {
  const url = await target((_req, res) => { res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  const { stdout } = await exec(process.execPath, ["scripts/perf-load.mjs", "--url", url, "--duration", "1", "--concurrency", "2", "--ws-connections", "0", "--expect-json", '{"ok":true}']);
  const report = JSON.parse(stdout);
  expect(report.successes).toBeGreaterThan(0);
  expect(report.failures).toBe(0);
  expect(report.loadGenerator.pid).toBeTypeOf("number");
  expect(report.serverEventLoopDelayMs).toBeNull();
  expect(report.broadcastAcceptance).toBeNull();
  expect(report.processSamples.every(s => s.role === "loadtest")).toBe(true);
});

it("fails the run on a misleading HTTP 200 body", async () => {
  const url = await target((_req, res) => { res.end("<html>login</html>"); });
  const failure = await exec(process.execPath, ["scripts/perf-load.mjs", "--url", url, "--duration", "1", "--concurrency", "1", "--ws-connections", "0", "--expect-json", '{"ok":true}']).catch(e => e);
  expect(failure.code).toBe(1);
  const report = JSON.parse(failure.stdout);
  expect(report.successes).toBe(0);
  expect(report.unexpectedBody).toBe(report.requests);
});

it("counts a rejected WebSocket handshake once and exits without hanging", async () => {
  const url = await target((_req, res) => { res.statusCode = 401; res.end(); });
  const failure = await exec(process.execPath, ["scripts/perf-load.mjs", "--url", url, "--ws", url.replace("http:", "ws:"), "--duration", "1", "--concurrency", "0", "--ws-connections", "1"]).catch(e => e);
  expect(failure.code).toBe(1);
  const report = JSON.parse(failure.stdout);
  expect(report.websocket.opened).toBe(0);
  expect(report.websocket.failed).toBe(1);
});

it("includes timed out requests in latency statistics", async () => {
  const url = await target(() => { /* intentionally never respond */ });
  const failure = await exec(process.execPath, ["scripts/perf-load.mjs", "--url", url, "--duration", "1", "--timeout", "1", "--concurrency", "1", "--ws-connections", "0"]).catch(e => e);
  expect(failure.code).toBe(1);
  const report = JSON.parse(failure.stdout);
  expect(report.timeouts).toBeGreaterThan(0);
  expect(report.latencyMs.count).toBe(report.requests);
});
