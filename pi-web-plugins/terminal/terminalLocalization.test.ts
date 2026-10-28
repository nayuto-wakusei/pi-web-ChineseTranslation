// @vitest-environment happy-dom
import { html, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LocalizationService } from "../../src/client/src/localization/service";
import { createPluginLocalization } from "../../src/client/src/plugins/localization";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalSoftKeys } from "./TerminalSoftKeys";
import { createTerminalContent } from "./terminalLocalization";
import { activateTerminalPlugin, defineTerminalCustomElements } from "./pi-web-plugin";
import type { TerminalCopySnapshot } from "./terminalCopySnapshot";

const lifetimes: AbortController[] = [];
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
});

function fixture() {
  const service = new LocalizationService({ development: true, preferences: { language: "en", formatLocale: "de-DE" }, diagnostic: () => undefined });
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const localization = createPluginLocalization(service, "pi-web.terminal", "pi-web.terminal", lifetime.signal);
  const content = createTerminalContent(localization);
  defineTerminalCustomElements();
  const element = document.createElement("pi-web-terminal-panel-pi-web-terminal");
  if (!(element instanceof TerminalPanel)) throw new Error("Missing terminal panel");
  element.content = content;
  document.body.append(element);
  return { service, localization, content, element };
}

async function settle(element: TerminalPanel) {
  await element.updateComplete;
  await element.updateComplete;
}

it("updates child key names and tooltips live without changing physical key sequences", async () => {
  const { service, element } = fixture();
  await settle(element);
  Reflect.set(element, "selectedId", "shell");
  Reflect.set(element, "terminals", [{ id: "shell", name: "user shell <img>", cwd: "/repo", exited: false }, { id: "generated", name: "Shell 1234", defaultShellNumber: 1234, cwd: "/repo", exited: false }]);
  Reflect.set(element, "softKeysEnabled", true);
  await settle(element);
  const keys = element.shadowRoot?.querySelector("pi-web-terminal-soft-keys-pi-web-terminal");
  if (!(keys instanceof TerminalSoftKeys)) throw new Error("Missing soft keys");
  await keys.updateComplete;
  const input = vi.fn();
  keys.onInput = input;
  expect(keys.shadowRoot?.querySelector("button")?.getAttribute("aria-label")).toBe("Escape");
  service.registerCatalog({ id: "test", namespace: "plugin:pi-web.terminal:terminal", locale: "fr", load: () => Promise.resolve({ "escape.aria": "Échap", "escape.title": "Envoyer Échap", shell: "+ Console", shellName: "Console {number, number}" }) });
  await service.setPreferences({ ...service.preferences, language: "fr" });
  await settle(element);
  await keys.updateComplete;
  const escape = keys.shadowRoot?.querySelector("button");
  expect(escape?.getAttribute("aria-label")).toBe("Échap");
  expect(escape?.title).toBe("Envoyer Échap");
  expect(escape?.textContent).toBe("Esc");
  keys.onInput = input;
  escape?.click();
  expect(input).toHaveBeenCalledWith("\x1b", { refocus: true });
  expect(element.shadowRoot?.textContent).toContain("+ Console");
  expect(element.shadowRoot?.textContent).toContain("Console 1.234");
  expect(element.shadowRoot?.textContent).toContain("user shell <img>");
  expect(element.shadowRoot?.querySelector("img")).toBeNull();
});

it("retranslates cached copy and connection state while preserving output and regional counts", async () => {
  const { service, element } = fixture();
  await settle(element);
  Reflect.set(element, "visible", true);
  const snapshot: TerminalCopySnapshot = { text: "echo <img> /repo", lines: [], physicalLineCount: 1234, viewportLine: 0 };
  Reflect.set(element, "copySnapshot", snapshot);
  Reflect.set(element, "copyStatus", "copied");
  Reflect.set(element, "connectionError", { kind: "connectionClosed", detail: 1011 });
  await settle(element);
  expect(element.shadowRoot?.textContent).toContain("1.234 rows");
  expect(element.shadowRoot?.textContent).toContain("Copied all terminal output.");
  expect(element.shadowRoot?.textContent).toContain("code 1011");
  const selector = element.shadowRoot?.querySelector("textarea");
  expect(selector?.value).toBe(snapshot.text);
  for (const language of ["en-XA", "ar-XB"]) {
    await service.setPreferences({ ...service.preferences, language });
    await settle(element);
    expect(element.shadowRoot?.textContent).not.toContain("Copied all terminal output.");
    expect(selector?.value).toBe(snapshot.text);
    expect(selector?.dir).toBe("ltr");
    expect(element.shadowRoot?.textContent).toContain("1.234");
    expect(element.shadowRoot?.textContent).toContain("1011");
  }
});

it("localizes whole command notices and exit codes, preserving rich shortcuts and command text", async () => {
  const { service, element } = fixture();
  await settle(element);
  Reflect.set(element, "visible", true);
  Reflect.set(element, "selectedId", "shell");
  Reflect.set(element, "terminals", [{ id: "shell", name: "User shell", cwd: "/repo", exited: false, commandRunId: "run" }]);
  const run = { id: "run", title: "User title <img>", command: "echo <img>", status: "running", terminalId: "shell" };
  Reflect.set(element, "commandRuns", [run]);
  await settle(element);
  expect(element.shadowRoot?.querySelector("kbd")?.textContent).toBe("Ctrl+C");
  await service.setPreferences({ ...service.preferences, language: "ar-XB" });
  await settle(element);
  expect(element.shadowRoot?.querySelector("kbd")?.textContent).toBe("Ctrl+C");
  expect(element.shadowRoot?.querySelector("code")?.textContent).toBe(run.command);
  expect(element.shadowRoot?.querySelector("code")?.dir).toBe("ltr");
  expect(element.shadowRoot?.textContent).toContain(run.title);
  expect(element.shadowRoot?.querySelector("img")).toBeNull();
  Reflect.set(element, "terminals", [{ id: "shell", name: "User shell", cwd: "/repo", exited: true, commandRunId: "run" }]);
  Reflect.set(element, "commandRuns", [{ ...run, status: "failed", exitCode: 1234 }]);
  await service.setPreferences({ ...service.preferences, language: "en" });
  await settle(element);
  expect(element.shadowRoot?.textContent).toContain("Command failed with exit code 1.234");
  expect(element.shadowRoot?.textContent).toContain("Continue in shell");
});

it("retranslates generated removal titles and tabs without changing authored titles or commands", async () => {
  const { service, element } = fixture();
  await settle(element);
  const title = "Delete workspace: feature/<img>";
  const titlePresentation = { kind: "workspaceRemoval", label: "feature/<img>" };
  Reflect.set(element, "visible", true);
  Reflect.set(element, "selectedId", "generated");
  Reflect.set(element, "terminals", [
    { id: "generated", name: title, titlePresentation, cwd: "/repo", exited: false, commandRunId: "run" },
    { id: "authored", name: title, cwd: "/repo", exited: false },
  ]);
  const run = { id: "run", title, titlePresentation, command: "git worktree remove '/repo/<img>'", status: "running", terminalId: "generated" };
  Reflect.set(element, "commandRuns", [run]);
  await settle(element);
  expect(element.shadowRoot?.querySelector("strong")?.textContent).toBe(title);
  for (const language of ["en-XA", "ar-XB", "en"]) {
    await service.setPreferences({ ...service.preferences, language });
    await settle(element);
    const heading = element.shadowRoot?.querySelector("strong")?.textContent;
    if (heading === undefined) throw new Error("Expected generated command title");
    const names = element.shadowRoot?.querySelectorAll(".terminal-tabs bdi");
    expect(heading).toContain(titlePresentation.label);
    if (language === "en") expect(heading).toBe(title);
    else expect(heading).not.toBe(title);
    expect(names?.[0]?.closest("button")?.getAttribute("title")).toBe(`${heading} · /repo`);
    expect(names?.[1]?.closest("button")?.getAttribute("title")).toBe(`${title} · /repo`);
    expect(element.shadowRoot?.querySelector("code")?.textContent).toBe(run.command);
    expect(element.shadowRoot?.querySelector("img")).toBeNull();
  }
});

it("releases observers on detach and switches localization owners without stale subscriptions", async () => {
  const { service, content, element } = fixture();
  await settle(element);
  element.remove();
  await service.setPreferences({ ...service.preferences, language: "en-XA" });
  document.body.append(element);
  await settle(element);
  expect(element.shadowRoot?.textContent).not.toContain("+ Shell");
  const replacement = new LocalizationService({ preferences: { language: "en", formatLocale: "en" } });
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  element.content = createTerminalContent(createPluginLocalization(replacement, "pi-web.terminal", "other", lifetime.signal));
  await settle(element);
  expect(element.shadowRoot?.textContent).toContain("+ Shell");
  const update = vi.spyOn(element, "requestUpdate");
  await service.setPreferences({ ...service.preferences, language: "ar-XB" });
  expect(update).not.toHaveBeenCalled();
  element.content = content;
  await settle(element);
  expect(element.shadowRoot?.textContent).not.toContain("+ Shell");
});

it("keeps contribution metadata live across language changes", async () => {
  const service = new LocalizationService({ development: true });
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const localization = createPluginLocalization(service, "pi-web.terminal", "pi-web.terminal", lifetime.signal);
  const result = activateTerminalPlugin({ apiVersion: 5, pluginId: "pi-web.terminal", runtimePluginId: "pi-web.terminal", html, svg, localization, signal: lifetime.signal, lifetimeSignal: lifetime.signal });
  expect(result.contributions.applicationPanels?.[0]?.title).toBe("Terminal");
  await service.setPreferences({ ...service.preferences, language: "en-XA" });
  expect(result.contributions.applicationPanels?.[0]?.title).not.toBe("Terminal");
  expect(result.contributions.actions?.[0]?.title).not.toBe("Go to Terminal");
  expect(result.contributions.actions?.[0]?.group).not.toBe("Navigation");
  await result.dispose?.(new AbortController().signal);
});
