import { expect, test, type Page } from "@playwright/test";
import { PI_WEB_PLUGIN_LIFECYCLE_VERSION } from "../../src/shared/apiTypes";

const modulePath = "**/fixture-startup-presentation.js";
const stylesheetPath = "**/fixture-startup-presentation.css";
const startupPage = "/presentation-startup.html?view=navigation";
const terminalSource = `export default {
  apiVersion: 5, name: "Fixture Terminal",
  activate: () => ({ contributions: {}, provides: [{
    capability: { pluginId: "pi-web.terminal", id: "browser-facade", version: 1, parse: (value) => value },
    value: { version: 1, createWorkspaceTerminal() { throw new Error("No terminal in this fixture"); },
      listCommandRuns: async () => [], parseCommandRun: (value) => value },
  }] }),
};`;
const pluginSource = `export default {
  apiVersion: 5, name: "Fixture startup presentation",
  requires: [{ pluginId: "pi-web", id: "ui-presentation", version: 1, parse: (value) => value }],
  activate: ({ html }) => ({ contributions: {
    stylesheets: [{ id: "layout", url: new URL("./fixture-startup-presentation.css", import.meta.url).href }],
    uiPresentations: [{ id: "navigation", region: "navigation", navigationLayout: "tree",
      render: () => html\`<div class="fixture-presentation"><slot name="header"></slot><slot name="projects"></slot></div>\` }],
  } }),
};`;

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function setup(page: Page, enabled: boolean, authenticated = true): Promise<void> {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "No daemon in this fixture" } }));
  await page.route("**/api/machines", (route) => route.fulfill({ json: { machines: [{ id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" }] } }));
  await page.route("**/api/machines/local/projects", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/theme-bootstrap", (route) => route.fulfill({ json: {
    catalog: { themes: [{ id: "test:light", pluginId: "test", name: "Light", colorScheme: "light", stylesheets: [] }],
      themePairs: [], defaultTheme: { themeId: "test:light", auto: false } },
    stylesheets: [],
  } }));
  await page.route("**/api/normal-auth/status", (route) => route.fulfill({ json: { configured: true, authenticated } }));
  await page.route("**/api/normal-auth/login", (route) => {
    authenticated = true;
    return route.fulfill({ json: { accepted: true } });
  });
  await page.route("**/fixture-startup-terminal.js", (route) => route.fulfill({ contentType: "text/javascript", body: terminalSource }));
  await page.route("**/pi-web-plugins/manifest.json", (route) => route.fulfill({ json: {
    lifecycleVersion: PI_WEB_PLUGIN_LIFECYCLE_VERSION, terminalMode: "required",
    plugins: [{ id: "pi-web.terminal", module: "../fixture-startup-terminal.js", machineSpecific: true,
      scope: "bundled", source: "bundled", backendRevision: "terminal-r1", pairedRequestVersion: 1, pairedChannelVersion: 1 },
    ...(enabled ? [{ id: "fixture-presentation", module: "../fixture-startup-presentation.js", machineSpecific: false }] : [])],
  } }));
}

test("the first visible shell waits for gateway presentation markup and styles", async ({ page }) => {
  await setup(page, true);
  const module = deferred();
  const sheet = deferred();
  await page.route(modulePath, async (route) => {
    await module.promise;
    await route.fulfill({ contentType: "text/javascript", body: pluginSource });
  });
  await page.route(stylesheetPath, async (route) => {
    await sheet.promise;
    await route.fulfill({ contentType: "text/css", body: ".fixture-presentation { display: grid; }" });
  });
  const moduleRequested = page.waitForRequest(modulePath);
  await page.goto(startupPage, { waitUntil: "domcontentloaded" });
  try {
    await moduleRequested;
    await expect(page.locator("#pi-web-startup")).toBeVisible();
    await expect(page.locator("pi-web-app .shell")).toBeHidden();
    const stylesheetRequested = page.waitForRequest(stylesheetPath);
    module.release();
    await stylesheetRequested;
    await expect(page.locator("#pi-web-startup")).toBeVisible();
    await expect(page.locator("pi-web-app .shell")).toBeHidden();
    sheet.release();
    await expect(page.locator("#pi-web-startup")).toHaveCount(0);
    await expect(page.locator(".fixture-presentation")).toBeVisible();
    await expect(page.locator(".fixture-presentation")).toHaveCSS("display", "grid");
  } finally {
    module.release();
    sheet.release();
  }
});

for (const stylesheetFails of [false, true]) {
  test(`startup reveals the default shell when presentation is ${stylesheetFails ? "broken" : "disabled"}`, async ({ page }) => {
    await setup(page, stylesheetFails);
    await page.route(modulePath, (route) => route.fulfill({ contentType: "text/javascript", body: pluginSource }));
    await page.route(stylesheetPath, (route) => route.fulfill({ status: 503 }));
    await page.goto(startupPage);
    await expect(page.locator("#pi-web-startup")).toHaveCount(0);
    await expect(page.locator("pi-web-app .shell")).toBeVisible();
    await expect(page.locator(".fixture-presentation")).toHaveCount(0);
  });
}

test("login remains usable without plugins and does not reveal an unstyled shell after sign-in", async ({ page }) => {
  await setup(page, true, false);
  const module = deferred();
  await page.route(modulePath, async (route) => {
    await module.promise;
    await route.fulfill({ contentType: "text/javascript", body: pluginSource });
  });
  await page.route(stylesheetPath, (route) => route.fulfill({ contentType: "text/css", body: ".fixture-presentation { display: grid; }" }));
  await page.goto(startupPage);
  try {
    await expect(page.locator("#pi-web-startup")).toHaveCount(0);
    const login = page.locator("normal-auth-dialog");
    await expect(login.locator("input[type=password]")).toBeEnabled();
    await login.locator("input[type=password]").fill("fixture-password");
    const requested = page.waitForRequest(modulePath);
    const submit = login.locator("button.primary");
    await submit.click();
    await requested;
    await expect(submit).toBeDisabled();
    await expect(page.locator("pi-web-app .shell")).toHaveCount(0);
    module.release();
    await expect(page.locator(".fixture-presentation")).toHaveCSS("display", "grid");
    await expect(login).toHaveCount(0);
  } finally {
    module.release();
  }
});
