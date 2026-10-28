// @vitest-environment happy-dom
import { html } from "lit";
import { Directive, directive } from "lit/directive.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiPresentationRenderContextV1 } from "../../../plugin-api";
import { UiPresentationRuntime, UiPresentationSurface } from "./uiPresentation";
import { PluginRegistry } from "./registry";
import { uiPresentationCapabilityToken } from "./uiPresentationRuntime";
import { PluginStylesheetLoadError } from "./styleRegistry";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

function context(): UiPresentationRenderContextV1 {
  return { mode: "normal", region: "navigation", slots: ["header", "sessions"] };
}

describe("gateway UI presentations", () => {
  it("preserves the instance-bound file toolbar capability through registration", async () => {
    const registry = new PluginRegistry();
    let capability: import("../../../plugin-api").UiPresentationCapabilityV1 | undefined;
    await registry.register({ id: "custom", plugin: {
      apiVersion: 5, name: "Custom", requires: [uiPresentationCapabilityToken],
      activate: () => ({
        start: ({ capabilities }) => { capability = capabilities.resolve(uiPresentationCapabilityToken); },
        contributions: { uiPresentations: [{ id: "files", region: "files-toolbar", render: () => html`<button>Upload</button>` }] },
      }),
    } });
    const update = vi.fn();
    const release = capability?.subscribe?.(update);
    expect(capability?.render?.({ mode: "normal", region: "files-toolbar", slots: [] })).toBeDefined();
    expect(capability?.fail?.("files-toolbar", new Error("failed"))).toBe(true);
    expect(update).toHaveBeenCalledOnce();
    expect(capability?.render?.({ mode: "normal", region: "files-toolbar", slots: [] })).toBeUndefined();
    release?.();
    await registry.dispose();
  });
  it("invalidates retained actions on inactivity, including after fallback and reactivation", async () => {
    let active = true;
    const run = vi.fn();
    const contexts: UiPresentationRenderContextV1[] = [];
    const runtime = new UiPresentationRuntime();
    runtime.register([{ id: "custom:nav", pluginId: "custom", region: "navigation", active: () => active, render: (value) => { contexts.push(value); return html`<main><slot name="header"></slot></main>`; } }]);
    const surface = new UiPresentationSurface();
    surface.runtime = runtime;
    surface.context = { mode: "normal", actions: [{ id: "open", label: "Open", run }] };
    document.body.append(surface);
    await surface.updateComplete;
    const retained = contexts.at(-1)?.actions?.[0];
    await retained?.run();
    expect(run).toHaveBeenCalledOnce();
    active = false;
    await retained?.run();
    expect(run).toHaveBeenCalledOnce();
    surface.requestUpdate();
    await surface.updateComplete;
    expect(surface.shadowRoot?.querySelector("main")).toBeNull();
    active = true;
    await retained?.run();
    expect(run).toHaveBeenCalledOnce();
    surface.requestUpdate();
    await surface.updateComplete;
    await contexts.at(-1)?.actions?.[0]?.run();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("enables host tree composition only for the active navigation owner", () => {
    let active = true;
    const runtime = new UiPresentationRuntime(() => undefined);
    runtime.register([{ id: "custom:nav", pluginId: "custom", region: "navigation", navigationLayout: "tree", active: () => active, render: () => html`` }]);
    expect(runtime.navigationLayout()).toBe("tree");
    active = false;
    expect(runtime.navigationLayout()).toBeUndefined();
    active = true;
    runtime.fail("navigation", new Error("Intentional failure"));
    expect(runtime.navigationLayout()).toBeUndefined();
    runtime.clear();
    expect(runtime.navigationLayout()).toBeUndefined();
  });

  it("rejects unsupported or non-navigation tree layout requests", async () => {
    for (const region of ["navigation", "chat-chrome"] as const) {
      const presentation = { id: "bad", region, navigationLayout: "tree" as const, render: () => html`` };
      if (region === "navigation") Reflect.set(presentation, "navigationLayout", "grid");
      const registry = new PluginRegistry();
      await expect(registry.register({ id: "custom", plugin: {
        apiVersion: 5, name: "Custom", requires: [uiPresentationCapabilityToken],
        activate: () => ({ contributions: { uiPresentations: [presentation] } }),
      } })).rejects.toThrow("navigation layout");
      await registry.dispose();
    }
  });

  it("keeps gateway presentation and styles active when navigating to a remote machine", async () => {
    let selectedMachine = "local";
    const registry = new PluginRegistry({ isContributionEnabled: (_id, machineId) => machineId === undefined || machineId === selectedMachine });
    await registry.register({ id: "custom", plugin: {
      apiVersion: 5, name: "Custom", requires: [uiPresentationCapabilityToken],
      activate: () => ({ contributions: {
        stylesheets: [{ id: "skin", url: "https://fixture.test/skin.css" }],
        uiPresentations: [{ id: "nav", region: "navigation", render: () => html`<slot name="sessions"></slot>` }],
      } }),
    } });
    selectedMachine = "remote";
    expect(registry.uiPresentation.render(context())).toBeDefined();
    expect(registry.getStylesheets("remote")).toHaveLength(1);
    await registry.dispose();
  });

  it("does not grant app-global eligibility to a presentation owner's workspace operations", async () => {
    const registry = new PluginRegistry({ isContributionEnabled: (_id, machineId) => machineId === undefined });
    await registry.register({ id: "custom", plugin: {
      apiVersion: 5, name: "Custom", requires: [uiPresentationCapabilityToken],
      activate: () => ({ contributions: {
        stylesheets: [{ id: "skin", url: "https://fixture.test/skin.css" }],
        workspacePanels: [{ id: "files", title: "Files", render: () => html`` }],
        uiPresentations: [{ id: "nav", region: "navigation", render: () => html`<slot name="sessions"></slot>` }],
      } }),
    } });
    expect(registry.uiPresentation.render(context())).toBeDefined();
    expect(registry.getStylesheets("remote")).toHaveLength(1);
    expect(registry.resolveWorkspacePanelRouteId("custom:files", "remote")).toBeUndefined();
    await registry.dispose();
  });

  it("requires v5 capability and rejects remote and machine-specific registrations", async () => {
    for (const scope of [{ machineId: "remote" }, { machineSpecific: true }]) {
      const registry = new PluginRegistry();
      await expect(registry.register({ id: "custom", ...scope, plugin: {
        apiVersion: 5, name: "Custom", requires: [uiPresentationCapabilityToken],
        activate: () => ({ contributions: { uiPresentations: [{ id: "nav", region: "navigation", render: () => html`<slot name="sessions"></slot>` }] } }),
      } })).rejects.toThrow("gateway-owned");
      await registry.dispose();
    }
    const registry = new PluginRegistry();
    await expect(registry.register({ id: "missing", plugin: {
      apiVersion: 5, name: "Missing capability",
      activate: () => ({ contributions: { uiPresentations: [{ id: "nav", region: "navigation", render: () => html`` }] } }),
    } })).rejects.toThrow("ui-presentation capability v1");
    await registry.dispose();
  });

  it("rejects region conflicts without replacing the first owner", async () => {
    const registry = new PluginRegistry();
    for (const id of ["first", "second"]) {
      const registration = { id, plugin: {
        apiVersion: 5 as const, name: id, requires: [uiPresentationCapabilityToken],
        activate: () => ({ contributions: { uiPresentations: [{ id: "nav", region: "navigation" as const, render: () => html`<p>${id}</p>` }] } }),
      } };
      if (id === "first") await registry.register(registration);
      else await expect(registry.register(registration)).rejects.toThrow("already has an owner");
    }
    expect(registry.uiPresentation.render(context())?.values).toContain("first");
    await registry.dispose();
  });

  it("restores all regions and excludes styles and themes after a renderer fails", async () => {
    const report = vi.fn();
    const registry = new PluginRegistry({ onUiPresentationError: report });
    await registry.register({ id: "custom", plugin: {
      apiVersion: 5, name: "Custom", requires: [uiPresentationCapabilityToken],
      activate: () => ({ contributions: {
        stylesheets: [{ id: "skin", url: "https://fixture.test/skin.css" }],
        themes: [{ id: "palette", name: "Palette", colorScheme: "light", stylesheets: [] }],
        uiPresentations: [
          { id: "nav", region: "navigation", render: () => { throw new Error("broken renderer"); } },
          { id: "chat", region: "chat-chrome", render: () => html`<slot name="transcript"></slot>` },
        ],
      } }),
    } });
    expect(registry.getStylesheets("remote")).toHaveLength(1);
    expect(registry.uiPresentation.render(context())).toBeUndefined();
    expect(report).toHaveBeenCalledOnce();
    expect(registry.uiPresentation.render({ ...context(), region: "chat-chrome" })).toBeUndefined();
    expect(registry.getStylesheets("remote")).toHaveLength(0);
    expect(registry.getThemes()).toHaveLength(0);
    await registry.dispose();
  });

  it("keeps host-owned editor nodes and their drafts mounted through disable and dispose", async () => {
    let active = true;
    const runtime = new UiPresentationRuntime();
    runtime.register([{ id: "custom:chat", pluginId: "custom", region: "chat-chrome", active: () => active, render: () => html`<main><slot name="transcript"></slot><footer><slot name="composer"></slot></footer></main>` }]);
    const surface = new UiPresentationSurface();
    surface.region = "chat-chrome";
    surface.runtime = runtime;
    const editor = document.createElement("textarea");
    editor.slot = "composer";
    editor.value = "unsent draft";
    surface.append(editor);
    document.body.append(surface);
    await surface.updateComplete;
    expect(surface.shadowRoot?.querySelector("main")).not.toBeNull();
    active = false;
    surface.requestUpdate();
    await surface.updateComplete;
    expect(surface.shadowRoot?.querySelector("main")).toBeNull();
    expect(surface.querySelector("textarea")).toBe(editor);
    runtime.clear();
    await surface.updateComplete;
    expect(editor.value).toBe("unsent draft");
    expect(editor.isConnected).toBe(true);
  });

  it("falls back only for a failed asset's exact presentation owner", async () => {
    const report = vi.fn();
    const registry = new PluginRegistry({ onUiPresentationError: report });
    await registry.register({ id: "custom", plugin: {
      apiVersion: 5, name: "Custom", requires: [uiPresentationCapabilityToken],
      activate: () => ({ contributions: {
        stylesheets: [{ id: "skin", url: "https://fixture.test/skin.css" }],
        themes: [{ id: "palette", name: "Palette", colorScheme: "light", stylesheets: [{ id: "colors", url: "https://fixture.test/palette.css" }] }],
        uiPresentations: [{ id: "nav", region: "navigation", render: () => html`<slot name="sessions"></slot>` }],
      } }),
    } });
    expect(registry.failUiPresentationStylesheetError(new Error("Failed to load stylesheet custom:skin (https://fixture.test/skin.css)"))).toBe(false);
    expect(registry.failUiPresentationStylesheetError(new PluginStylesheetLoadError({ id: "other:skin", url: "https://fixture.test/skin.css" }, new Error("offline")))).toBe(false);
    expect(registry.uiPresentation.render(context())).toBeDefined();
    const failure = new PluginStylesheetLoadError({ id: "custom:palette:colors", url: "https://fixture.test/palette.css" }, new Error("offline"));
    expect(registry.failUiPresentationStylesheetError(new AggregateError([failure], "assets unavailable"))).toBe(true);
    expect(report).toHaveBeenCalledExactlyOnceWith("custom", failure);
    expect(registry.uiPresentation.render(context())).toBeUndefined();
    expect(registry.getStylesheets("local")).toEqual([]);
    await registry.dispose();
  });

  it("falls back when a plugin directive throws while Lit commits the template", async () => {
    class BrokenDirective extends Directive {
      override render(): never { throw new Error("commit failed"); }
    }
    const broken = directive(BrokenDirective);
    const report = vi.fn();
    const runtime = new UiPresentationRuntime(report);
    runtime.register([{ id: "custom:nav", pluginId: "custom", region: "navigation", active: () => true, render: () => html`<div>${broken()}</div>` }]);
    const surface = new UiPresentationSurface();
    surface.runtime = runtime;
    const hostControl = document.createElement("button");
    hostControl.slot = "header";
    surface.append(hostControl);
    document.body.append(surface);
    await surface.updateComplete;
    await surface.updateComplete;
    expect(report).toHaveBeenCalledOnce();
    expect(surface.shadowRoot?.querySelector('slot[name="header"]')).not.toBeNull();
    expect(hostControl.isConnected).toBe(true);
  });

  it("provides sanitized immutable snapshots and invalidates retained actions after scope changes", async () => {
    const run = vi.fn();
    const captured: UiPresentationRenderContextV1[] = [];
    const runtime = new UiPresentationRuntime();
    runtime.register([{ id: "custom:nav", pluginId: "custom", region: "navigation", active: () => true, render: (value) => { captured.push(value); return html`<slot name="sessions"></slot>`; } }]);
    const surface = new UiPresentationSurface();
    surface.runtime = runtime;
    const machine = { id: "same", name: "First", secret: "not public" };
    surface.context = { mode: "management", machine, actions: [{ id: "open", label: "Open", run }] };
    document.body.append(surface);
    await surface.updateComplete;
    const previous = captured[0];
    expect(previous?.machine).toEqual({ id: "same", name: "First" });
    expect(Object.isFrozen(previous?.machine)).toBe(true);
    await previous?.actions?.[0]?.run();
    expect(run).toHaveBeenCalledTimes(1);
    surface.context = { mode: "normal", machine: { id: "other", name: "Second" } };
    await surface.updateComplete;
    await previous?.actions?.[0]?.run();
    expect(run).toHaveBeenCalledTimes(1);
    surface.remove();
    runtime.clear();
  });
});
