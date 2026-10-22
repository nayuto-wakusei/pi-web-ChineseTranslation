import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAVIGATION_PREFERENCE_ROUTES } from "../shared/navigationPreferences.js";
import { createTranslator } from "../shared/i18n.js";
import { registerNavigationPreferenceRoutes } from "./navigationPreferenceRoutes.js";
import { NavigationPreferenceStore } from "./storage/navigationPreferenceStore.js";

const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-nav-routes-")); roots.push(directory);
  const file = join(directory, "navigation-preferences.json");
  const store = new NavigationPreferenceStore(file);
  const app = Fastify({ logger: false }); apps.push(app);
  registerNavigationPreferenceRoutes(app, store);
  registerNavigationPreferenceRoutes(app, store, "/api/machines/local");
  return { app, store, file };
}

describe("normal machine navigation preference routes", () => {
  it.each([
    "/navigation/projects",
    "/navigation/projects/project%2Fone/workspaces",
    "/navigation/projects/project%2Fone/workspaces/workspace%2Fone/session-pins",
  ])("shares local aliases and conditional writes for %s", async (path) => {
    const { app, file } = await fixture();
    expect((await app.inject(`/api${path}`)).json()).toEqual({ ids: [], revision: 0 });
    const written = await app.inject({ method: "PUT", url: `/api/machines/local${path}`, payload: { ids: ["offline-id", "first-id"], revision: 0 } });
    expect(written.json()).toEqual({ ids: ["offline-id", "first-id"], revision: 1 });
    expect((await app.inject(`/api${path}`)).json()).toEqual(written.json());
    expect(await readFile(file, "utf8")).toContain("offline-id");
    expect((await app.inject({ method: "PUT", url: `/api${path}`, payload: { ids: ["duplicate", "duplicate"] } })).statusCode).toBe(400);
    const stale = await app.inject({ method: "PUT", url: `/api${path}`, payload: { ids: ["old"], revision: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ ids: ["offline-id", "first-id"], revision: 1 });
    expect((await app.inject({ method: "PUT", url: `/api${path}`, payload: { ids: [], revision: 1 } })).json()).toEqual({ ids: [], revision: 2 });
  });

  it("isolates each machine store and opaque project/workspace tuple", async () => {
    const first = await fixture();
    const second = await fixture();
    const path = "/api/navigation/projects/p1/workspaces/w1/session-pins";
    await first.app.inject({ method: "PUT", url: path, payload: { ids: ["session-id"] } });
    expect((await second.app.inject(path)).json()).toEqual({ ids: [], revision: 0 });
    for (const scoped of ["p1/workspaces/w2", "p2/workspaces/w1"]) {
      expect((await first.app.inject(`/api/navigation/projects/${scoped}/session-pins`)).json()).toEqual({ ids: [], revision: 0 });
    }
  });

  it("reports corrupt state without replacing it with an empty preference", async () => {
    const { app, file } = await fixture();
    const corrupt = '{"version":1,"entries":[{"scope":{"kind":"projects"},"ids":[1]}]}';
    await writeFile(file, corrupt);
    expect((await app.inject("/api/navigation/projects")).statusCode).toBe(500);
    expect((await app.inject({ method: "PUT", url: "/api/navigation/projects", payload: { ids: [] } })).statusCode).toBe(500);
    expect(await readFile(file, "utf8")).toBe(corrupt);
  });

  it.each([false, true])("rejects authenticated management before accessing ordinary stores (privileged=%s)", async (privileged) => {
    const app = Fastify({ logger: false }); apps.push(app);
    const store = { get: vi.fn(), put: vi.fn() };
    const options = { managementEmbed: {
      enabled: true, projectRoot: process.cwd(),
      authenticate: () => Promise.resolve({
        user: { id: "managed-user", rootUserId: "root", roles: [], permissions: [] }, projects: [],
        privileged: { bash: privileged, network: privileged },
      }),
    } };
    for (const prefix of ["/api", "/api/machines/local"]) registerNavigationPreferenceRoutes(app, store, prefix, options);
    for (const prefix of ["/api", "/api/machines/local"]) {
      for (const path of NAVIGATION_PREFERENCE_ROUTES) {
        const url = `${prefix}${path.replace(":projectId", "project").replace(":workspaceId", "workspace")}?embed=management&token=fixture-token`;
        expect((await app.inject(url)).statusCode).toBe(403);
        expect((await app.inject({ method: "PUT", url, payload: { ids: ["managed-session"] } })).statusCode).toBe(403);
      }
    }
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("does not downgrade invalid management authentication to ordinary preferences", async () => {
    const app = Fastify({ logger: false }); apps.push(app);
    const store = { get: vi.fn(), put: vi.fn() };
    registerNavigationPreferenceRoutes(app, store, "/api", { managementEmbed: {
      enabled: true, projectRoot: process.cwd(), authenticate: () => Promise.reject(new Error("Invalid management token")),
    } });
    const url = "/api/navigation/projects?embed=management&token=invalid";
    expect((await app.inject(url)).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url, payload: { ids: [] } })).statusCode).toBe(401);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("translates owned validation and conflict text without changing returned IDs", async () => {
    const { store } = await fixture();
    await store.put({ kind: "projects" }, { ids: ["raw-id"], revision: 0 });
    const app = Fastify({ logger: false }); apps.push(app);
    registerNavigationPreferenceRoutes(app, store, "/api", { translator: createTranslator("test", {
      "navigationPreference.idsUnique": "Local duplicate validation", "navigationPreference.conflict": "Local conflict",
    }) });
    const invalid = await app.inject({ method: "PUT", url: "/api/navigation/projects", payload: { ids: ["x", "x"] } });
    expect(invalid.json()).toEqual({ error: "Local duplicate validation" });
    const conflict = await app.inject({ method: "PUT", url: "/api/navigation/projects", payload: { ids: [], revision: 0 } });
    expect(conflict.json()).toEqual({ error: "Local conflict", ids: ["raw-id"], revision: 1 });
  });
});
