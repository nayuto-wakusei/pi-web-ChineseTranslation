import { afterEach, expect, it, vi } from "vitest";
import { html } from "lit";
import type { ContentRendererContributionV5 as ContentRendererContribution } from "../../../plugin-api";
import { PluginRegistry } from "./registry";
import { contentRendererMatches, snapshotContentRenderer } from "./contentRenderers";

function contribution(): ContentRendererContribution { return { id: "diagram", languages: ["Mermaid"], fileExtensions: ["MMD"], render: ({ text }) => html`${text}` }; }
function plugin() { return { apiVersion: 5 as const, name: "Diagram", activate: () => ({ contributions: { contentRenderers: [contribution()] } }) }; }
const request = { machineId: "remote", text: "graph TD", language: "MERMAID extra" };

afterEach(() => { vi.restoreAllMocks(); });

it("retains discovery order when imports finish in reverse and activation runs by ID", async () => {
    const registry = new PluginRegistry();
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const completed: import("./types").PiWebPluginRegistration[] = [];
    const first = new Promise<void>((resolve) => { finishFirst = resolve; }).then(() => { completed.push({ id: "z-first", plugin: plugin() }); });
    const second = new Promise<void>((resolve) => { finishSecond = resolve; }).then(() => { completed.push({ id: "a-second", plugin: plugin() }); });
    finishSecond();
    await second;
    finishFirst();
    await first;
    const result = await registry.registerBatch(completed, { declarations: [{ id: "z-first" }, { id: "a-second" }] });
    expect(result.failures).toEqual([]);
    expect(registry.contentRendering.listRenderers(request).map(({ id }) => id)).toEqual(["z-first:diagram", "a-second:diagram"]);
    await registry.dispose();
  });

it("validates dynamic eligibility and titles, restricts selectors, and isolates supports failures", async () => {
    const registry = new PluginRegistry();
    const supports = vi.fn((value: import("../../../plugin-api").ContentRenderRequest) => value.machineId === "remote");
    await registry.register({ id: "dynamic", plugin: { ...plugin(), activate: () => ({ contributions: { contentRenderers: [
      { id: "dynamic", title: "Highlighted", supports, render: () => html`preview` },
      { ...contribution(), id: "restricted", supports: () => false },
      { ...contribution(), id: "broken", supports: () => { throw new Error("bad eligibility"); } },
    ] } }) } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(registry.contentRendering.listRenderers(request)).toEqual([{ id: "dynamic:dynamic", label: "Highlighted", title: "Highlighted", renderMode: "manual" }]);
    expect(supports).toHaveBeenCalledWith(request);
    expect(warn).toHaveBeenCalledWith("Content renderer eligibility failed", { rendererId: "dynamic:broken", category: "eligibility" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("bad eligibility");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(request.text);
    warn.mockRestore();
    for (const [key, value] of [["supports", true], ["title", 12], ["title", " "]] as const) {
      const invalid = contribution();
      Reflect.set(invalid, key, value);
      expect(() => snapshotContentRenderer(invalid)).toThrow(key);
    }
    await registry.dispose();
  });

it("does not call retained eligibility callbacks after the owning plugin shuts down", async () => {
    const registry = new PluginRegistry();
    const supports = vi.fn(() => true);
    await registry.register({ id: "owner", plugin: { ...plugin(), activate: () => ({ contributions: {
      contentRenderers: [{ ...contribution(), supports }],
    } }) } });
    const retained = registry.matchContentRenderers(request)[0];
    if (retained === undefined) throw new Error("Expected matching renderer");
    supports.mockClear();
    registry.beginShutdown();
    expect(contentRendererMatches(retained.renderer, request)).toBe(false);
    expect(supports).not.toHaveBeenCalled();
    await registry.dispose();
  });

it("excludes asynchronous eligibility and consumes rejection without breaking source rendering", async () => {
    const invalid = contribution();
    const failure = new Error("async eligibility failed");
    Reflect.set(invalid, "supports", () => Promise.reject(failure));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(contentRendererMatches(snapshotContentRenderer(invalid), request)).toBe(false);
      await Promise.resolve();
      expect(warn).toHaveBeenCalledWith("Content renderer eligibility failed", { rendererId: "diagram", category: "eligibility" });
    } finally {
      warn.mockRestore();
    }
  });

it("keeps each machine's rendering input stable until its eligible renderer set changes", async () => {
    const registry = new PluginRegistry();
    const capability = registry.contentRendering;
    const local = registry.getChatContentRendering("local");
    const remote = registry.getChatContentRendering("remote");
    expect(registry.getChatContentRendering("local")).toBe(local);
    expect(registry.getChatContentRendering("remote")).toBe(remote);
    await registry.register({ id: "unrelated", plugin: { apiVersion: 4, name: "Unrelated", activate: () => ({ contributions: {} }) } });
    expect(registry.getChatContentRendering("local")).toBe(local);
    await registry.register({ id: "local-diagram", machineId: "local", machineSpecific: true, plugin: plugin() });
    const available = registry.getChatContentRendering("local");
    expect(available).not.toBe(local);
    expect(registry.getChatContentRendering("local")).toBe(available);
    expect(registry.getChatContentRendering("remote")).toBe(remote);
    // Retained public capabilities keep querying the live registry, not a chat snapshot.
    expect(registry.contentRendering).toBe(capability);
    expect(capability.listRenderers({ ...request, machineId: "local" })).toHaveLength(1);
    expect(capability.listRenderers(request)).toEqual([]);
    await registry.dispose();
    expect(registry.getChatContentRendering("local")).not.toBe(available);
    expect(capability.listRenderers({ ...request, machineId: "local" })).toEqual([]);
  });
