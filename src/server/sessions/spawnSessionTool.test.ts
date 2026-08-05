import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSpawnSessionToolDefinition } from "./spawnSessionTool.js";

const dispatchModel = { provider: "anthropic", id: "claude-sonnet" };

function ctxFor(sessionId: string, model?: unknown): ExtensionContext {
  const sessionManager = { getSessionId: () => sessionId };
  // The spawn tool only reads sessionManager.getSessionId and model.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub with the minimal surface the tool reads.
  return { sessionManager, ...(model === undefined ? {} : { model }) } as unknown as ExtensionContext;
}

describe("createSpawnSessionToolDefinition", () => {
  it("passes the spawning identity, explicit cwd, dispatching model, and prompt to spawn callback", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "new-1", cwd: "/repos/a-feature" }));
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn });

    const result = await tool.execute("call-1", { prompt: "do the thing", cwd: "/repos/a-feature" }, undefined, undefined, ctxFor("spawner-1", dispatchModel));

    expect(spawn).toHaveBeenCalledWith({ spawningCwd: "/repos/a", spawningSessionId: "spawner-1", prompt: "do the thing", cwd: "/repos/a-feature", model: dispatchModel });
    expect(result.details).toEqual({ sessionId: "new-1", cwd: "/repos/a-feature" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "已在 /repos/a-feature 启动独立会话 new-1。" });
  });

  it("forwards omitted cwd as undefined and omits a missing dispatching model", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "new-2", cwd: "/repos/a" }));
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn });

    await tool.execute("call-2", { prompt: "continue" }, undefined, undefined, ctxFor("spawner-1"));

    expect(spawn).toHaveBeenCalledWith({ spawningCwd: "/repos/a", spawningSessionId: "spawner-1", prompt: "continue", cwd: undefined });
  });

  it("forwards an explicit model as a model spec alongside the inherited model", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "new-3", cwd: "/repos/a", model: "openai/gpt-5" }));
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn });

    const result = await tool.execute("call-3", { prompt: "continue", model: "openai/gpt-5" }, undefined, undefined, ctxFor("spawner-1", dispatchModel));

    expect(spawn).toHaveBeenCalledWith({
      spawningCwd: "/repos/a",
      spawningSessionId: "spawner-1",
      prompt: "continue",
      cwd: undefined,
      model: dispatchModel,
      modelSpec: "openai/gpt-5",
    });
    expect(result.details).toEqual({ sessionId: "new-3", cwd: "/repos/a", model: "openai/gpt-5" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "已在 /repos/a 启动独立会话 new-3，使用模型 openai/gpt-5。" });
  });

  it("teaches the model parameter format and the #provider/model-id reference convention", () => {
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn: vi.fn() });

    expect(tool.parameters).toMatchObject({
      properties: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- stringMatching yields `any` against the loosely typed tool schema.
        model: { description: expect.stringMatching(/provider\/model-id.*#provider\/model-id.*省略时继承/s) },
      },
    });
  });

  it("propagates the spawn callback error so the agent loop reports it", async () => {
    const spawn = vi.fn(() => Promise.reject(new Error("cwd must be a workspace of this project. Allowed: /repos/a")));
    const tool = createSpawnSessionToolDefinition("/repos/a", { spawn });

    await expect(tool.execute("call-4", { prompt: "x", cwd: "/elsewhere" }, undefined, undefined, ctxFor("spawner-1")))
      .rejects.toThrow("cwd must be a workspace of this project. Allowed: /repos/a");
  });
});
