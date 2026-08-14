import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types.js";
import type { WorkspaceListing } from "../../shared/apiTypes.js";
import { CachedWorkspaceAttribution } from "./workspaceAttribution.js";

describe("CachedWorkspaceAttribution", () => {
  it("attributes deepest matching workspace and caches provider listings", async () => {
    const project: Project = { id: "p1", name: "Project", path: "/repo", createdAt: "now" };
    const list = vi.fn((): Promise<WorkspaceListing[]> => Promise.resolve([
      { id: "root", projectId: "p1", path: "/repo", label: "root", isMain: true },
      { id: "nested", projectId: "p1", path: "/repo/nested", label: "nested", isMain: false },
    ]));
    const attribution = new CachedWorkspaceAttribution({ projects: { list: () => Promise.resolve([project]) }, workspaces: { list }, logger: { warn: vi.fn() } });
    expect((await attribution.attribute(["/repo/nested/src"])).get("/repo/nested/src")).toEqual({ projectId: "p1", workspaceId: "nested" });
    await attribution.attribute(["/repo/src"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("does not match a sibling with a shared string prefix", async () => {
    const project: Project = { id: "p1", name: "Project", path: "/repo/wt1", createdAt: "now" };
    const attribution = new CachedWorkspaceAttribution({ projects: { list: () => Promise.resolve([project]) }, workspaces: { list: () => Promise.resolve([{ id: "w1", projectId: "p1", path: "/repo/wt1", label: "w1", isMain: true }]) }, logger: { warn: vi.fn() } });
    expect((await attribution.attribute(["/repo/wt10"])).size).toBe(0);
  });
});
