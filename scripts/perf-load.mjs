#!/usr/bin/env node
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import process from "node:process";
import { WebSocket } from "ws";

const options = parseArgs(process.argv.slice(2));
const durationMs = options.duration * 1000;
const deadline = Date.now() + durationMs;
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
const latencies = [];
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
      const response = await fetch(options.url, { headers: options.headers });
      await response.arrayBuffer();
      requests += 1;
      latencies.push(performance.now() - started);
      if (response.ok) successes += 1;
      else failures += 1;
    } catch {
      requests += 1;
      failures += 1;
    }
  }
}

function openWebSocket() {
  return new Promise((resolve) => {
    const socket = new WebSocket(options.ws, { headers: options.headers });
    sockets.push(socket);
    const timer = setTimeout(() => { wsFailed += 1; socket.terminate(); resolve(); }, options.timeout * 1000);
    socket.once("open", () => { clearTimeout(timer); wsOpened += 1; resolve(); });
    socket.once("error", () => { clearTimeout(timer); wsFailed += 1; resolve(); });
  });
}

await Promise.all([
  ...[...Array(options.concurrency)].map(() => requestLoop()),
  ...[...Array(options.wsConnections)].map(() => openWebSocket()),
]);
await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));
for (const socket of sockets) socket.close();
histogram.disable();

const cpu = process.cpuUsage(cpuStart);
const elapsed = (performance.now() - wallStart) / 1000;
const result = {
  url: options.url,
  ws: options.ws,
  durationSeconds: elapsed,
  concurrency: options.concurrency,
  wsConnections: options.wsConnections,
  requests,
  successes,
  failures,
  requestsPerSecond: requests / elapsed,
  latencyMs: percentileSummary(latencies),
  websocket: { opened: wsOpened, failed: wsFailed, successRate: options.wsConnections === 0 ? 1 : wsOpened / options.wsConnections },
  eventLoopDelayMs: { p50: histogram.percentile(50) / 1e6, p95: histogram.percentile(95) / 1e6, p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6 },
  process: { rssBytes: process.memoryUsage().rss, cpuUserSeconds: cpu.user / 1e6, cpuSystemSeconds: cpu.system / 1e6 },
};
console.log(JSON.stringify(result, null, 2));

function percentileSummary(values) {
  if (values.length === 0) return { count: 0, p50: null, p95: null, p99: null, max: null };
  values.sort((a, b) => a - b);
  return { count: values.length, p50: at(values, 0.5), p95: at(values, 0.95), p99: at(values, 0.99), max: values.at(-1) };
}

function at(values, percentile) { return values[Math.min(values.length - 1, Math.ceil(values.length * percentile) - 1)]; }

function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: npm run perf:load -- [--url URL] [--ws URL] [--duration SEC] [--concurrency N] [--ws-connections N] [--timeout SEC] [--header 'name:value,name:value']");
    process.exit(0);
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--")) continue;
    values.set(key.slice(2), args[index + 1]);
    index += 1;
  }
  const url = values.get("url") ?? "http://127.0.0.1:8504/api/sessiond/health";
  const headers = values.has("header") ? Object.fromEntries(String(values.get("header")).split(",").map((item) => item.split(/:(.*)/s, 2))) : {};
  return {
    url,
    ws: values.get("ws") ?? url.replace(/^http/, "ws").replace(/\/api\/.*$/, "/api/events"),
    concurrency: number(values.get("concurrency"), 200),
    wsConnections: number(values.get("ws-connections"), 200),
    duration: number(values.get("duration"), 60),
    timeout: number(values.get("timeout"), 10),
    headers,
  };
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
