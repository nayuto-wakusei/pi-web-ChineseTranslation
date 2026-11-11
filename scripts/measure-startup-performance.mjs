import { createWriteStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { STARTUP_MESSAGE, STARTUP_PROJECT, startStartupFixture } from "./startup-performance-fixture.mjs";

const { values } = parseArgs({ options: {
  "out-dir": { type: "string", default: "node_modules/.cache/pi-web/performance/startup" },
  samples: { type: "string", default: "20" },
  "skip-trace": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} });
if (values.help) {
  console.log("Run npm run build first. Usage: node scripts/measure-startup-performance.mjs [--out-dir DIR] [--samples 20] [--skip-trace]");
  process.exit(0);
}
const count = Number(values.samples);
if (!Number.isSafeInteger(count) || count < 1) throw new Error("--samples must be a positive integer");
const output = resolve(values["out-dir"]);
await Promise.all(["dist/server/index.js", "dist/server/sessiond.js", "dist/client/index.html", "dist/.plugins-ready"].map(async (path) => {
  await access(path).catch(() => { throw new Error(`Missing ${path}; run npm run build first`); });
}));
await mkdir(output, { recursive: true });

const devices = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
};
const scenarios = ["login", "workspace", "session"];
const groups = Object.entries(devices).flatMap(([device, options]) => scenarios.map((scenario) => ({ device, options, scenario, samples: [], trace: null })));
const fixture = await startStartupFixture();
let browser;
let interrupted = false;
const interrupt = () => { interrupted = true; void browser?.close(); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  for (let run = 1; run <= count && !interrupted; run++) {
    for (const group of groups) {
      if (interrupted) break;
      group.samples.push({ run, ...await measure(group) });
    }
    if (run === 1 || run % 5 === 0 || run === count) console.log(`Completed sample ${run}/${count} for each scenario and device`);
  }
  if (!values["skip-trace"]) {
    for (const group of groups) {
      if (interrupted) break;
      const name = `${group.device}-${group.scenario}.trace.json`;
      group.trace = { file: name, ...await measure(group, join(output, name)) };
    }
  }
  const results = groups.map(({ device, options, scenario, samples, trace }) => ({
    device, options, scenario, samples, trace, summary: summarize(samples),
  }));
  const report = {
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, browser: browser.version(), platform: platform(), release: release(), cpu: cpus()[0]?.model },
    samplesPerGroup: count,
    interrupted,
    definitions: {
      readyMs: "First animation frame with localized, visible scenario controls after the startup overlay is gone; actionability verified separately.",
      fcpMs: "Document first-contentful-paint; may describe the startup overlay rather than the application.",
      requestsBeforeReady: "Same-origin HTTP requests initiated before readiness, including the document.",
      jsTransferBytesBeforeReady: "Resource Timing transferSize (including headers) for completed JavaScript resources by readiness; excludes unfinished transfers.",
      longTasksBeforeReady: "Long Task API entries starting before readiness, including full task durations.",
      percentile: "Nearest rank, over successful samples only. Failures and HTTP diagnostics remain in raw samples.",
      cache: "Fresh Chromium context per sample; browser process and isolated Web/API and sessiond stay running; no CPU or network throttling.",
    },
    results,
  };
  const reportPath = join(output, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(reportPath);
  for (const { device, scenario, summary, trace } of results) {
    const timing = summary.readyMs;
    console.log(`${device}/${scenario}: ${summary.successes}/${count} successful; ${timing ? `ready p50 ${timing.p50.toFixed(1)} ms, p95 ${timing.p95.toFixed(1)} ms` : "no readiness samples"}`);
    for (const failure of summary.failures) console.error(`  ${failure.error} (${failure.count})`);
    if (trace?.error) console.error(`  Trace: ${trace.error}`);
  }
  if (interrupted || results.some(({ summary, trace }) => summary.successes !== count || trace?.error)) process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  try { await browser?.close(); } finally { await fixture.close(); }
}

async function measure({ device, options, scenario }, tracePath) {
  let context;
  try {
    context = await browser.newContext({ ...options, locale: "zh-CN" });
    if (scenario !== "login") {
      const equal = fixture.cookie.indexOf("=");
      await context.addCookies([{ url: fixture.origin, name: fixture.cookie.slice(0, equal), value: fixture.cookie.slice(equal + 1), httpOnly: true }]);
    }
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const session = await context.newCDPSession(page);
    const requests = [];
    const diagnostics = [];
    const pageErrors = [];
    page.on("pageerror", (error) => { pageErrors.push(error.message); });
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
        diagnostics.push({ consoleError: message.text().split("\n")[0] });
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) diagnostics.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    page.on("requestfailed", (request) => {
      diagnostics.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
    });
    await session.send("Network.enable");
    session.on("Network.requestWillBeSent", ({ request, type, wallTime }) => {
      const url = new URL(request.url);
      if (url.origin === fixture.origin) requests.push({ path: url.pathname, type, epochMs: wallTime * 1000 });
    });
    const navigationSelector = device === "mobile" ? "app-context-bar button.context-chip" : 'project-list [data-project-id][aria-current="true"]';
    await page.addInitScript(observeStartup, { device, scenario, project: STARTUP_PROJECT, message: STARTUP_MESSAGE });
    let result;
    if (tracePath) await session.send("Tracing.start", {
      categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,loading,v8",
      transferMode: "ReturnAsStream",
    });
    try {
      const url = scenario === "login" ? fixture.origin : scenario === "workspace" ? fixture.projectUrl : fixture.sessionUrl;
      const response = await page.goto(url, { waitUntil: "commit" });
      if (!response?.ok()) throw new Error(`Document HTTP ${response?.status() ?? "missing response"}`);
      await page.waitForFunction(() => window.startupBenchmark.ready !== undefined);
      const snapshot = await page.evaluate(() => window.startupBenchmark.snapshot());
      const beforeReady = requests.filter(({ epochMs }) => epochMs <= snapshot.timeOrigin + snapshot.readyMs);
      const started = beforeReady.map(({ epochMs, ...request }) => ({ ...request, startMs: epochMs - snapshot.timeOrigin }));
      if (scenario === "session") {
        const editor = page.locator("prompt-editor .cm-content");
        await editor.fill("benchmark verification");
        if (!(await editor.textContent())?.includes("benchmark verification")) throw new Error("Prompt editor did not accept text");
      } else {
        const button = scenario === "login" ? page.locator("normal-auth-dialog button.primary")
          : page.locator(navigationSelector).filter({ hasText: STARTUP_PROJECT });
        await button.click({ trial: true });
      }
      if (pageErrors.length) throw new Error(pageErrors.join("; "));
      if (snapshot.fcpMs === null) throw new Error("First contentful paint was not reported");
      result = { ...snapshot, requestsBeforeReady: started.length, started };
    } catch (error) {
      result = { error: error.message.split("\n")[0] };
    }
    if (tracePath) await writeTrace(session, tracePath);
    return { ...result, diagnostics: [...diagnostics], pageErrors: [...pageErrors] };
  } catch (error) {
    return { error: error.message.split("\n")[0] };
  } finally {
    await context?.close();
  }
}

function observeStartup({ device, scenario, project, message }) {
  const tasks = [];
  const record = (entries) => tasks.push(...entries.map(({ startTime, duration }) => ({ startTime, duration })));
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type: "longtask", buffered: true });
  const state = window.startupBenchmark = {
    ready: undefined,
    async snapshot() {
      // Paint and Long Task entries are delivered asynchronously.
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      record(observer.takeRecords());
      const readyMs = state.ready;
      const resources = performance.getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).origin === location.origin && entry.startTime <= readyMs)
        .map(({ name, initiatorType, startTime, responseEnd, transferSize, encodedBodySize }) => ({
          path: new URL(name).pathname, initiatorType, startTime, responseEnd, transferSize, encodedBodySize,
        }));
      return {
        timeOrigin: performance.timeOrigin,
        readyMs,
        ttfbMs: performance.getEntriesByType("navigation")[0].responseStart,
        fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        jsTransferBytesBeforeReady: resources.filter(({ path, responseEnd }) => /\.m?js$/u.test(path) && responseEnd <= readyMs)
          .reduce((total, { transferSize }) => total + transferSize, 0),
        longTasksBeforeReady: tasks.filter(({ startTime }) => startTime < readyMs),
        resources,
      };
    },
  };
  const visible = (element) => element?.checkVisibility({ visibilityProperty: true }) === true;
  const chinese = (text) => /\p{Script=Han}/u.test(text ?? "");
  function check() {
    const root = document.querySelector("pi-web-app")?.shadowRoot;
    let ready = false;
    if (root && document.documentElement.lang === "zh-CN" && !document.documentElement.hasAttribute("data-pi-web-loading")) {
      if (scenario === "login") {
        const dialog = root.querySelector("normal-auth-dialog")?.shadowRoot;
        const button = dialog?.querySelector("button.primary");
        ready = visible(button) && !button.disabled && chinese(dialog.querySelector("h1")?.textContent);
      } else if (scenario === "workspace") {
        const nav = device === "mobile" ? root.querySelector("app-context-bar")?.shadowRoot
          : root.querySelector("aside app-navigation-panel")?.shadowRoot?.querySelector("project-list")?.shadowRoot;
        const rows = nav?.querySelectorAll(device === "mobile" ? "button.context-chip" : '[data-project-id][aria-current="true"]');
        ready = !root.querySelector("prompt-editor") && [...(rows ?? [])].some((row) => {
          const label = device === "mobile" ? row.getAttribute("aria-label") : row.querySelector("button.action-menu-toggle")?.getAttribute("aria-label");
          return visible(row) && chinese(label) && row.textContent.includes(project);
        });
      } else {
        const editor = root.querySelector("prompt-editor")?.shadowRoot?.querySelector(".cm-content");
        const chat = root.querySelector("chat-view");
        const content = chat?.shadowRoot?.querySelector(".chat article formatted-text")?.shadowRoot;
        const text = content?.querySelector(".pending-source:not([hidden]), .enhanced-content:not([hidden]) p");
        ready = visible(editor) && editor.isContentEditable && chinese(editor.getAttribute("aria-label"))
          && chat?.historyReady === true && visible(text) && text.textContent.includes(message);
      }
    }
    if (ready) state.ready = performance.mark("pi-web-startup-ready").startTime;
    else requestAnimationFrame(check);
  }
  requestAnimationFrame(check);
}

async function writeTrace(session, path) {
  const completed = new Promise((done) => session.once("Tracing.tracingComplete", done));
  await session.send("Tracing.end");
  const { stream } = await completed;
  if (!stream) throw new Error("Chromium did not return a trace stream");
  async function* read() {
    for (;;) {
      const { data, base64Encoded, eof } = await session.send("IO.read", { handle: stream });
      yield base64Encoded ? Buffer.from(data, "base64") : data;
      if (eof) break;
    }
  }
  try { await pipeline(Readable.from(read()), createWriteStream(path)); } finally { await session.send("IO.close", { handle: stream }); }
}

function summarize(samples) {
  const successes = samples.filter((sample) => !sample.error);
  const errors = new Map();
  for (const { error } of samples) if (error) errors.set(error, (errors.get(error) ?? 0) + 1);
  const summary = { successes: successes.length, failures: [...errors].map(([error, count]) => ({ error, count })) };
  for (const key of ["readyMs", "ttfbMs", "fcpMs", "requestsBeforeReady", "jsTransferBytesBeforeReady", "longTasksBeforeReady"]) {
    const sorted = successes.map((sample) => key === "longTasksBeforeReady" ? sample[key].length : sample[key]).sort((a, b) => a - b);
    summary[key] = sorted.length ? { p50: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] } : null;
  }
  return summary;
}
