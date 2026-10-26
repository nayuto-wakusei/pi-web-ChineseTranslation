import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { build, preview } from "vite";

const output = resolve(process.argv[2] ?? "node_modules/.cache/pi-web/performance/latest.json");
const label = process.argv[3] ?? "working-tree";
const sourceRef = process.argv[4]?.startsWith("--") === false ? process.argv[4] : undefined;
const customUi = process.argv.includes("--custom-ui");
if (sourceRef !== undefined) process.env.PI_WEB_PERFORMANCE_REF = sourceRef;
const configFile = resolve("test-fixtures/browser/performance.config.ts");
await mkdir(dirname(output), { recursive: true });
await build({ configFile, logLevel: "warn" });
const server = await preview({ configFile, logLevel: "warn", preview: { host: "127.0.0.1", port: 8517, strictPort: true } });
let browser;
const samples = [];
try {
  browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] });
  for (let run = 0; run < 5; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => { console.error(error); });
    let requests = 0;
    page.on("request", () => { requests++; });
    await page.goto(`http://127.0.0.1:8517/performance.html${customUi ? "?custom-ui" : ""}`);
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    const startup = await page.evaluate(() => ({
      readyMs: performance.now(),
      resourceBytes: performance.getEntriesByType("resource").reduce((total, entry) => total + entry.encodedBodySize, 0),
    }));
    const scenarios = {};
    for (const scenario of ["chat", "switch", "navigation"]) {
      scenarios[scenario] = await page.evaluate((value) => window.runUiPerformanceScenario(value), scenario);
      const expected = scenario === "chat" ? [600, 600] : scenario === "switch" ? [120, 120] : [5000, 50];
      if (scenarios[scenario].retainedMessages !== expected[0] || scenarios[scenario].renderedRows !== expected[1]) throw new Error(`Unexpected retained/rendered content in ${scenario}`);
      if (run === 0) await page.screenshot({ path: output.replace(/\.json$/u, `-${scenario}.png`) });
    }
    const session = await context.newCDPSession(page);
    await session.send("HeapProfiler.collectGarbage");
    const heap = await session.send("Runtime.getHeapUsage");
    await page.evaluate(() => document.querySelector("main").replaceChildren());
    await session.send("HeapProfiler.collectGarbage");
    const cleaned = await session.send("Runtime.getHeapUsage");
    samples.push({ run, startup, requests, scenarios, heapUsedBytes: heap.usedSize, heapAfterCleanupBytes: cleaned.usedSize });
    await context.close();
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ label, sourceRef: sourceRef ?? null, customUi, measuredAt: new Date().toISOString(), browser: browser.version(), definitions: { startup: "Isolated component-fixture load, not the gateway/application startup", durations: "Lit update completion in milliseconds, excluding the following animation frame", timerDelays: "Synthetic zero-delay timer responsiveness probes, not real-user INP", heap: "Chromium collected heap before and after removing the fixture stage" }, samples }, null, 2) + "\n");
  console.log(output);
  for (const scenario of ["chat", "switch", "navigation"]) {
    const values = samples.flatMap((sample) => sample.scenarios[scenario].durations).sort((a, b) => a - b);
    console.log(`${scenario}: median ${values[Math.floor(values.length / 2)].toFixed(2)} ms; p95 ${values[Math.floor(values.length * 0.95)].toFixed(2)} ms`);
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose, reject) => { server.httpServer.close((error) => { if (error) reject(error); else resolveClose(); }); });
}
