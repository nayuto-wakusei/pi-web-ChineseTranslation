#!/usr/bin/env node
import { createHistogram, monitorEventLoopDelay, performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { createProcessSampler } from "./perf-process-sampler.mjs";
import process from "node:process";
import { WebSocket } from "ws";

const options = parseArgs(process.argv.slice(2));
if (options.auth !== "none") {
  if (!options.passwordFile) throw new Error("--password-file is required");
  const password = (await readFile(options.passwordFile, "utf8")).trim();
  if (!password) throw new Error("Empty password file");
  if (options.auth === "bearer") options.headers.authorization = `Bearer ${password}`;
  else {
    const login = new URL(options.url);
    const index = login.pathname.indexOf("/api/");
    if (index < 0) throw new Error("Cookie login requires /api/ URL");
    login.pathname = login.pathname.slice(0, index) + "/api/normal-auth/login";
    login.search = "";
    const res = await fetch(login, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(options.timeout * 1000) });
    await res.arrayBuffer();
    const cookie = res.headers.getSetCookie().find(c => c.startsWith("pi_web_normal_session="));
    if (!res.ok || !cookie) throw new Error(`Login failed: HTTP ${res.status}`);
    options.headers.cookie = cookie.split(";")[0];
  }
}
const sampler = createProcessSampler(options.pids);
await sampler.sample();
let sampling = Promise.resolve();
const samplingTimer = setInterval(() => { sampling = sampling.then(() => sampler.sample()); }, 1000);
const durationMs = options.duration * 1000;
const deadline = Date.now() + durationMs;
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
const latencies = createHistogram();
const connectLatencies = createHistogram();
const statuses = {};
let timeouts = 0;
let unexpectedBody = 0;
let disconnected = 0;
let messages = 0;
let cleanup = false;
let requests = 0;
let successes = 0;
let failures = 0;
let wsOpened = 0;
let wsFailed = 0;
const sockets = [];
const cpuStart = process.cpuUsage();
const wallStart = performance.now();

async function requestLoop() {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(options.url, { headers: options.headers, redirect: "error", signal: AbortSignal.timeout(options.timeout * 1000) });
      const body = await response.text();
      requests += 1;
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      let valid = response.ok;
      if (valid && options.expected !== undefined) {
        try { const actual = JSON.parse(body); valid = actual !== null && Object.entries(options.expected).every(([k, v]) => JSON.stringify(actual[k]) === JSON.stringify(v)); }
        catch { valid = false; }
        if (!valid) unexpectedBody++;
      }
      if (valid) successes += 1;
      else failures += 1;
    } catch (error) {
      requests += 1;
      failures += 1;
      if (error.name === "TimeoutError" || error.name === "AbortError") timeouts++;
    } finally {
      latencies.record(Math.max(1, Math.round((performance.now() - started) * 1000)));
    }
  }
}

function openWebSocket() {
  return new Promise((resolve) => {
    const began = performance.now();
    let settled = false, opened = false;
    const socket = new WebSocket(options.ws, { headers: options.headers, handshakeTimeout: options.timeout * 1000 });
    sockets.push(socket);
    const finish = (ok) => { if (settled) return; settled = true; clearTimeout(timer); if (!ok) wsFailed++; resolve(); };
    const timer = setTimeout(() => { finish(false); socket.terminate(); }, options.timeout * 1000);
    socket.once("open", () => { opened = true; wsOpened++; connectLatencies.record(Math.max(1, Math.round((performance.now() - began) * 1000))); finish(true); });
    socket.on("error", () => { finish(false); });
    socket.on("message", () => { messages++; });
    socket.once("close", () => { if (opened && !cleanup) disconnected++; finish(false); });
  });
}

await Promise.all([
  ...[...Array(options.concurrency)].map(() => requestLoop()),
  ...[...Array(options.wsConnections)].map(() => openWebSocket()),
]);
await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));
const alive = sockets.filter(s => s.readyState === WebSocket.OPEN).length;
const elapsed = (performance.now() - wallStart) / 1000;
cleanup = true;
await Promise.all(sockets.map(socket => new Promise(resolve => {
  if (socket.readyState === WebSocket.CLOSED) return resolve();
  const timer = setTimeout(() => { socket.terminate(); resolve(); }, 2000);
  socket.once("close", () => { clearTimeout(timer); resolve(); });
  socket.close();
})));
clearInterval(samplingTimer);
await sampling;
await sampler.sample();
histogram.disable();

const cpu = process.cpuUsage(cpuStart);
const result = {
  url: options.url,
  ws: options.ws,
  durationSeconds: elapsed,
  concurrency: options.concurrency,
  wsConnections: options.wsConnections,
  requests,
  successes,
  failures,
  timeouts, unexpectedBody, statuses, auth: options.auth,
  errorRate: requests ? failures / requests : null,
  requestsPerSecond: requests / elapsed,
  latencyMs: percentileSummary(latencies),
  websocket: { opened: wsOpened, failed: wsFailed, disconnected, messages, aliveBeforeCleanup: alive, connectLatencyMs: percentileSummary(connectLatencies), successRate: options.wsConnections === 0 ? null : wsOpened / options.wsConnections },
  loadGeneratorEventLoopDelayMs: { p50: histogram.percentile(50) / 1e6, p95: histogram.percentile(95) / 1e6, p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6 },
  loadGenerator: { pid: process.pid, rssBytes: process.memoryUsage().rss, cpuUserSeconds: cpu.user / 1e6, cpuSystemSeconds: cpu.system / 1e6 },
  processSamples: sampler.rows, serverEventLoopDelayMs: null, broadcastAcceptance: null,
};
if (options.output) {
  await writeFile(options.output, JSON.stringify(result, null, 2));
  await writeFile(options.output + ".metrics.tsv", ["timestamp\trole\tpid\tcpuPct\trssBytes\tfdCount", ...sampler.rows.map(r => [r.timestamp, r.role, r.pid, r.cpuPct, r.rssBytes, r.fdCount].join("\t"))].join("\n"));
}
console.log(JSON.stringify(result, null, 2));
if (failures || wsFailed || disconnected) process.exitCode = 1;

function percentileSummary(values) {
  if (values.count === 0) return { count: 0, p50: null, p95: null, p99: null, max: null };
  return { count: values.count, p50: values.percentile(50) / 1000, p95: values.percentile(95) / 1000, p99: values.percentile(99) / 1000, max: values.max / 1000 };
}


function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/perf-load.mjs --url URL --ws URL --duration 300 --concurrency 200 --ws-connections 200 --timeout 10 --auth bearer|cookie|none --password-file FILE --expect-json JSON --web-pid PID --sessiond-pid PID --output result.json");
    process.exit(0);
  }
  const values = new Map();
  const allowed = new Set(["url", "ws", "duration", "concurrency", "ws-connections", "timeout", "header", "auth", "password-file", "expect-json", "web-pid", "sessiond-pid", "output"]);
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--") || !allowed.has(key.slice(2)) || args[index + 1] === undefined) throw new Error("Unknown option or missing argument; use --help");
    values.set(key.slice(2), args[index + 1]);
    index += 1;
  }
  const url = values.get("url") ?? "http://127.0.0.1:8504/api/sessiond/health";
  const auth = values.get("auth") ?? "none";
  if (!["none", "bearer", "cookie"].includes(auth)) throw new Error("Invalid --auth");
  for (const target of [url, values.get("ws") ?? url]) {
    const parsed = new URL(target);
    if (parsed.username || parsed.password || [...parsed.searchParams.keys()].some(k => /token|password|secret/i.test(k))) throw new Error("Credentials in URLs are not supported; use --password-file");
  }
  const headers = values.has("header") ? Object.fromEntries(String(values.get("header")).split(",").map((item) => item.split(/:(.*)/s, 2))) : {};
  for (const key of ["duration", "timeout", "web-pid", "sessiond-pid"]) {
    if (values.has(key) && number(values.get(key), 0) === 0) throw new Error(`--${key} must be positive`);
  }
  const expected = values.has("expect-json") ? JSON.parse(values.get("expect-json")) : undefined;
  if (expected !== undefined && (expected === null || typeof expected !== "object" || Array.isArray(expected))) throw new Error("--expect-json must be a JSON object");
  return {
    url,
    ws: values.get("ws") ?? url.replace(/^http/, "ws").replace(/\/api\/.*$/, "/api/events"),
    concurrency: number(values.get("concurrency"), 200),
    wsConnections: number(values.get("ws-connections"), 200),
    duration: number(values.get("duration"), 60),
    timeout: number(values.get("timeout"), 10),
    headers,
    auth, passwordFile: values.get("password-file"), output: values.get("output"),
    expected,
    pids: { loadtest: process.pid, ...(values.has("web-pid") ? { web: number(values.get("web-pid"), 0) } : {}), ...(values.has("sessiond-pid") ? { sessiond: number(values.get("sessiond-pid"), 0) } : {}) },
  };
}

function number(value, fallback) {
  const parsed = Number(value);
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Expected nonnegative integer");
  return parsed;
}
