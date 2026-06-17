import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSpawnSessionToolDefinition } from "./spawnSessionTool.js";

// The spawn tool's execute() never reads ctx, so an empty stub is sufficient.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub; execute() does not use ctx.
const ctx = {} as ExtensionContext;

describe("createSpawnSessionToolDefinition", () => {
  it("passes the spawning cwd and params to the spawn callback and reports success", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "new-1", cwd: "/repos/a-feature" }));
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn });

    const result = await tool.execute("call-1", { prompt: "do the thing", cwd: "/repos/a-feature" }, undefined, undefined, ctx);

    expect(spawn).toHaveBeenCalledWith({ spawningCwd: "/repos/a", prompt: "do the thing", cwd: "/repos/a-feature" });
    expect(result.details).toEqual({ sessionId: "new-1", cwd: "/repos/a-feature" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "Started session new-1 in /repos/a-feature." });
  });

  it("defaults cwd to undefined so the service falls back to the spawning cwd", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "new-2", cwd: "/repos/a" }));
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn });

    await tool.execute("call-2", { prompt: "continue" }, undefined, undefined, ctx);

    expect(spawn).toHaveBeenCalledWith({ spawningCwd: "/repos/a", prompt: "continue", cwd: undefined });
  });

  it("propagates the spawn callback error so the agent loop reports it", async () => {
    const spawn = vi.fn(() => Promise.reject(new Error("cwd must be a workspace of this project. Allowed: /repos/a")));
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn });

    await expect(tool.execute("call-3", { prompt: "x", cwd: "/elsewhere" }, undefined, undefined, ctx))
      .rejects.toThrow("cwd must be a workspace of this project. Allowed: /repos/a");
  });
});
