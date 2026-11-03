import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSessionPinRoutes } from "../navigationPreferenceRoutes.js";
import { encodeManagementContext, MANAGEMENT_EMBED_CONTEXT_HEADER, type ManagementEmbedContext } from "../managementEmbed.js";
import type { Project } from "../types.js";
import { NavigationPreferenceConflictError, NavigationPreferenceStore } from "./navigationPreferenceStore.js";
import { SessionPinStore, sessionPinStorePath } from "./sessionPinStore.js";

let directory: string;
let file: string;
let legacy: string;
const scope = { projectId: "p/one", workspaceId: "w/one" };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "session-pins-"));
  file = sessionPinStorePath({ PI_WEB_DATA_DIR: directory });
  legacy = join(directory, "navigation-preferences.json");
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("daemon session pins", () => {
  it("leaves the retired scoped file untouched through startup, writes and restart", async () => {
    const scopedFile = join(directory, "session-pins.json");
    expect(file).not.toBe(scopedFile);
    await writeFile(scopedFile, JSON.stringify({ version: 1, scopes: {
      '["normal","/project"]': ["normal-pin"],
      '["management","root","user","/managed"]': ["management-pin"],
    } }));
    const original = await readFile(scopedFile, "utf8");
    await new NavigationPreferenceStore(legacy).put({ kind: "session-pins", ...scope }, { ids: ["navigation-pin"] });
    const pins = new SessionPinStore(file, legacy);
    expect(await pins.pinnedSessionIds()).toEqual(["navigation-pin"]);
    expect(await readFile(scopedFile, "utf8")).toBe(original);
    await pins.setPinned(scope, "another-pin", true);
    expect(await new SessionPinStore(file, legacy).get(scope)).toEqual({ ids: ["navigation-pin", "another-pin"], revision: 2 });
    expect(await readFile(scopedFile, "utf8")).toBe(original);
  });

  it("uses manually migrated navigation state without reimporting legacy pins", async () => {
    const previousFile = join(directory, "session-pins.json");
    const previous = new NavigationPreferenceStore(previousFile);
    await previous.put({ kind: "session-pins", ...scope }, { ids: ["old"] });
    await previous.put({ kind: "session-pins", ...scope }, { ids: [] });
    const other = { projectId: "other", workspaceId: "offline" };
    await previous.put({ kind: "session-pins", ...other }, { ids: ["two", "one"] });
    await new NavigationPreferenceStore(legacy).put({ kind: "session-pins", ...scope }, { ids: ["stale"] });
    const original = await readFile(previousFile, "utf8");
    await writeFile(file, original);
    const pins = new SessionPinStore(file, legacy);
    expect(await pins.get(scope)).toEqual({ ids: [], revision: 2 });
    expect(await pins.get(other)).toEqual({ ids: ["two", "one"], revision: 1 });
    expect(await readFile(previousFile, "utf8")).toBe(original);
    await writeFile(previousFile, "retired source must not be read again");
    expect(await new SessionPinStore(file, legacy).pinnedSessionIds()).toEqual(["one", "two"]);
    expect(await new SessionPinStore(file, legacy).get(scope)).toEqual({ ids: [], revision: 2 });
  });

  it("isolates durable managed pins by root/user and excludes them from ordinary cleanup and legacy imports", async () => {
    const context: ManagementEmbedContext = { user: { id: "user", rootUserId: "root", roles: [], permissions: [] }, projects: [] };
    const managed = { ...scope, managementContext: context };
    const changed = vi.fn();
    const pins = new SessionPinStore(file, legacy, changed);
    await pins.setPinned(scope, "ordinary", true);
    await pins.put(managed, { ids: ["private"], revision: 0 });
    expect(changed).toHaveBeenLastCalledWith(managed, 1);
    expect(await pins.pinnedSessionIds()).toEqual(["ordinary"]);
    const restarted = new SessionPinStore(file, legacy);
    expect(await restarted.get(managed)).toEqual({ ids: ["private"], revision: 1 });
    expect(await restarted.get({ ...managed, managementContext: { ...context, privileged: { bash: true, network: true } } })).toEqual({ ids: ["private"], revision: 1 });
    for (const user of [{ ...context.user, id: "other" }, { ...context.user, rootUserId: "other" }]) {
      expect(await restarted.get({ ...scope, managementContext: { ...context, user } })).toEqual({ ids: [], revision: 0 });
    }
    await expect(restarted.put(managed, { ids: [], revision: 0 })).rejects.toBeInstanceOf(NavigationPreferenceConflictError);
    expect(await restarted.get(scope)).toEqual({ ids: ["ordinary"], revision: 1 });
    const disk = await readFile(file, "utf8");
    expect(disk).not.toContain("permissions");
    expect(disk).not.toContain("privileged");
    expect(await new NavigationPreferenceStore(file).sessionPinSnapshot()).toHaveLength(1);
    await expect(restarted.put({ ...scope, managementContext: { ...context, user: { ...context.user, id: "" } } }, { ids: ["invalid"] })).rejects.toThrow("Management session pins require");
    const invalidFile = JSON.stringify({ version: 1, entries: [{ scope: { kind: "session-pins", ...scope, management: { rootUserId: "root" } }, ids: ["private"], revision: 1 }] });
    await writeFile(file, invalidFile);
    await expect(new SessionPinStore(file, legacy).get(scope)).rejects.toThrow("Invalid navigation preference state file");
  });

  it.each([false, true])("authorizes embedded navigation pins at the daemon boundary (privileged=%s)", async (privileged) => {
    const context: ManagementEmbedContext = {
      user: { id: "user", rootUserId: "root", roles: [], permissions: [] },
      projects: [{ id: "project", name: "Managed" }],
      ...(privileged ? { privileged: { bash: true, network: true } } : {}),
    };
    const app = Fastify();
    const ordinaryProject = vi.fn(() => Promise.reject(new Error("Managed requests must not resolve ordinary projects")));
    registerSessionPinRoutes(app, new SessionPinStore(file, legacy), "", {
      projects: { requireProject: ordinaryProject }, managementProjectRoot: directory,
      workspaces: { resolve: (project: Project) => Promise.resolve({ status: "folder", projectId: project.id, diagnostics: [], workspaces: [
        { id: "workspace", projectId: project.id, path: project.path, label: "Root", isMain: true },
      ] }) },
    });
    const headers = { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext(context) };
    const url = "/navigation/projects/project/workspaces/workspace/session-pins";
    try {
      expect((await app.inject({ method: "PUT", url, headers, payload: { ids: ["private"], revision: 0, management: { userId: "forged" } } })).json()).toEqual({ ids: ["private"], revision: 1 });
      expect((await app.inject({ method: "GET", url, headers })).json()).toEqual({ ids: ["private"], revision: 1 });
      expect((await app.inject({ method: "GET", url })).json()).toEqual({ ids: [], revision: 0 });
      const otherHeaders = { [MANAGEMENT_EMBED_CONTEXT_HEADER]: encodeManagementContext({ ...context, user: { ...context.user, id: "other" } }) };
      expect((await app.inject({ method: "GET", url, headers: otherHeaders })).json()).toEqual({ ids: [], revision: 0 });
      expect((await app.inject({ method: "PUT", url, headers, payload: { ids: [], revision: 0 } })).statusCode).toBe(409);
      expect((await app.inject({ method: "GET", url: url.replace("/project/", "/forbidden/"), headers })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: url.replace("/workspace/", "/missing/"), headers })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url, headers: { [MANAGEMENT_EMBED_CONTEXT_HEADER]: "invalid" } })).statusCode).toBe(401);
      expect(ordinaryProject).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("imports every pin scope, preserving order, revisions and cleared tombstones without modifying legacy state", async () => {
    const navigation = new NavigationPreferenceStore(legacy);
    await navigation.put({ kind: "projects" }, { ids: ["not-a-pin"] });
    await navigation.put({ kind: "session-pins", ...scope }, { ids: ["two", "one"] });
    const cleared = { projectId: "offline", workspaceId: "stale" };
    await navigation.put({ kind: "session-pins", ...cleared }, { ids: ["old"] });
    await navigation.put({ kind: "session-pins", ...cleared }, { ids: [] });
    const original = await readFile(legacy, "utf8");
    const pins = new SessionPinStore(file, legacy);
    expect(await pins.get(scope)).toEqual({ ids: ["two", "one"], revision: 1 });
    expect(await pins.get(cleared)).toEqual({ ids: [], revision: 2 });
    expect(await pins.pinnedSessionIds()).toEqual(["one", "two"]);
    expect(await readFile(legacy, "utf8")).toBe(original);
    expect(await readFile(file, "utf8")).not.toContain("not-a-pin");
    await expect(pins.put(cleared, { ids: ["resurrect"], revision: 1 })).rejects.toBeInstanceOf(NavigationPreferenceConflictError);
    await navigation.put({ kind: "session-pins", ...scope }, { ids: ["late-legacy"] });
    expect(await new SessionPinStore(file, legacy).get(scope)).toEqual({ ids: ["two", "one"], revision: 1 });
  });

  it("persists an empty import so later legacy writes cannot be reimported", async () => {
    expect(await new SessionPinStore(file, legacy).pinnedSessionIds()).toEqual([]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, entries: [] });
    await new NavigationPreferenceStore(legacy).put({ kind: "session-pins", ...scope }, { ids: ["late"] });
    expect(await new SessionPinStore(file, legacy).get(scope)).toEqual({ ids: [], revision: 0 });
  });

  it("fails closed on corrupt legacy or authoritative state and allows retry after repair", async () => {
    await writeFile(legacy, "broken");
    const pins = new SessionPinStore(file, legacy);
    await expect(pins.get(scope)).rejects.toThrow();
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await rm(legacy);
    expect(await pins.get(scope)).toEqual({ ids: [], revision: 0 });
    await writeFile(file, "broken");
    await expect(new SessionPinStore(file, legacy).pinnedSessionIds()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("broken");
  });

  it("serializes atomic pin changes with revisioned replacements and isolates opaque scope IDs", async () => {
    const pins = new SessionPinStore(file, legacy);
    await Promise.all([pins.setPinned(scope, "one", true), pins.setPinned(scope, "two", true)]);
    expect(await pins.get(scope)).toEqual({ ids: ["one", "two"], revision: 2 });
    expect(await pins.setPinned(scope, "one", true)).toEqual({ ids: ["one", "two"], revision: 2 });
    await expect(pins.put(scope, { ids: ["stale"], revision: 1 })).rejects.toBeInstanceOf(NavigationPreferenceConflictError);
    expect(await pins.setPinned(scope, "one", false)).toEqual({ ids: ["two"], revision: 3 });
    expect(await pins.get({ projectId: "p", workspaceId: "one/w/one" })).toEqual({ ids: [], revision: 0 });
    expect(await new SessionPinStore(file, legacy).get(scope)).toEqual({ ids: ["two"], revision: 3 });
  });

  it("publishes scoped invalidation only after committed writes, not import, no-op or failed CAS", async () => {
    const changed = vi.fn<(scope: { projectId: string; workspaceId: string }, revision: number) => void>();
    const pins = new SessionPinStore(file, legacy, changed);
    await pins.get(scope);
    expect(changed).not.toHaveBeenCalled();
    await pins.setPinned(scope, "one", true);
    expect(changed).toHaveBeenLastCalledWith(scope, 1);
    expect(await new SessionPinStore(file, legacy).get(scope)).toEqual({ ids: ["one"], revision: 1 });
    await pins.setPinned(scope, "one", true);
    await expect(pins.put(scope, { ids: [], revision: 0 })).rejects.toBeInstanceOf(NavigationPreferenceConflictError);
    expect(changed).toHaveBeenCalledTimes(1);
    await pins.put(scope, { ids: ["two"], revision: 1 });
    expect(changed).toHaveBeenCalledTimes(2);
    await pins.setPinned(scope, "two", false);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("keeps native navigation GET/PUT revisions and conflict responses compatible", async () => {
    const app = Fastify();
    registerSessionPinRoutes(app, new SessionPinStore(file, legacy));
    try {
      const url = "/navigation/projects/p%2Fone/workspaces/w%2Fone/session-pins";
      expect((await app.inject({ method: "GET", url })).json()).toEqual({ ids: [], revision: 0 });
      expect((await app.inject({ method: "PUT", url, payload: { ids: ["one"], revision: 0 } })).json()).toEqual({ ids: ["one"], revision: 1 });
      const stale = await app.inject({ method: "PUT", url, payload: { ids: [], revision: 0 } });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ ids: ["one"], revision: 1 });
      expect((await app.inject({ method: "PUT", url, payload: { ids: ["one", "one"] } })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/navigation/projects" })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
