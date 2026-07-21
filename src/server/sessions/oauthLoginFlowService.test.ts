import type { AuthInteraction } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthLoginFlowService } from "./oauthLoginFlowService.js";

type LoginHandler = (providerId: string, type: "oauth", interaction: AuthInteraction) => Promise<void>;

afterEach(() => {
  vi.useRealTimers();
});

describe("OAuthLoginFlowService", () => {
  it("round-trips prompt responses and completes the flow", async () => {
    let promptValue: string | undefined;
    const onComplete = vi.fn();
    const service = new OAuthLoginFlowService();
    const state = service.start({
      providerId: "test-provider",
      providerName: "Test Provider",
      modelRuntime: fakeModelRuntime(async (_providerId, _type, interaction) => {
        interaction.notify({ type: "auth_url", url: "https://example.test/auth", instructions: "Open it" });
        interaction.notify({ type: "progress", message: "Waiting for code" });
        promptValue = await interaction.prompt({ type: "text", message: "Paste code", placeholder: "code" });
        interaction.notify({ type: "progress", message: `Got ${promptValue}` });
      }),
      onComplete,
    });

    const prompt = state.prompt;
    if (prompt === undefined) throw new Error("Expected prompt");
    expect(state).toMatchObject({ auth: { url: "https://example.test/auth" }, progress: ["Waiting for code"] });
    expect(prompt).toMatchObject({ message: "Paste code", placeholder: "code", kind: "prompt" });

    const afterRespond = service.respond(state.flowId, prompt.requestId, "abc123");
    expect(afterRespond.prompt).toBeUndefined();
    await flushAsyncLogin();

    expect(promptValue).toBe("abc123");
    expect(service.get(state.flowId)).toMatchObject({ status: "complete", progress: ["Waiting for code", "Got abc123", "登录完成"] });
    expect(onComplete).toHaveBeenCalledOnce();
    service.dispose();
  });

  it("round-trips select responses", async () => {
    let selectedValue: string | undefined;
    const service = new OAuthLoginFlowService();
    const state = service.start({
      providerId: "test-provider",
      providerName: "Test Provider",
      modelRuntime: fakeModelRuntime(async (_providerId, _type, interaction) => {
        selectedValue = await interaction.prompt({
          type: "select",
          message: "Choose account",
          options: [{ id: "work", label: "Work" }, { id: "personal", label: "Personal" }],
        });
      }),
    });

    const select = state.select;
    if (select === undefined) throw new Error("Expected select prompt");
    expect(select).toMatchObject({ message: "Choose account", options: [{ value: "work", label: "Work" }, { value: "personal", label: "Personal" }] });

    service.respond(state.flowId, select.requestId, "personal");
    await flushAsyncLogin();

    expect(selectedValue).toBe("personal");
    expect(service.get(state.flowId).status).toBe("complete");
    service.dispose();
  });

  it("uses a manual-code prompt for callback-server flows", async () => {
    let manualValue: string | undefined;
    const service = new OAuthLoginFlowService();
    const state = service.start({
      providerId: "test-provider",
      providerName: "Test Provider",
      modelRuntime: fakeModelRuntime(async (_providerId, _type, interaction) => {
        manualValue = await interaction.prompt({ type: "manual_code", message: "粘贴回调 URL 或授权码" });
      }),
    });

    const prompt = state.prompt;
    if (prompt === undefined) throw new Error("Expected manual prompt");
    expect(prompt).toMatchObject({ kind: "manual", message: "粘贴回调 URL 或授权码" });

    service.respond(state.flowId, prompt.requestId, "https://localhost/callback?code=abc");
    await flushAsyncLogin();

    expect(manualValue).toBe("https://localhost/callback?code=abc");
    expect(service.get(state.flowId).status).toBe("complete");
    service.dispose();
  });

  it("rejects pending prompts when cancelled", async () => {
    const promptRejected = deferred<Error>();
    const service = new OAuthLoginFlowService();
    const state = service.start({
      providerId: "test-provider",
      providerName: "Test Provider",
      modelRuntime: fakeModelRuntime(async (_providerId, _type, interaction) => {
        try {
          await interaction.prompt({ type: "text", message: "Paste code" });
        } catch (error) {
          promptRejected.resolve(toError(error));
          throw error;
        }
      }),
    });

    expect(state.prompt).toBeDefined();
    expect(service.cancel(state.flowId)).toMatchObject({ status: "cancelled", error: "登录已取消" });

    await expect(promptRejected.promise).resolves.toMatchObject({ message: "登录已取消" });
    expect(service.get(state.flowId).status).toBe("cancelled");
    service.dispose();
  });

  it("rejects pending prompts when disposed", async () => {
    const promptRejected = deferred<Error>();
    const service = new OAuthLoginFlowService();
    const state = service.start({
      providerId: "test-provider",
      providerName: "Test Provider",
      modelRuntime: fakeModelRuntime(async (_providerId, _type, interaction) => {
        try {
          await interaction.prompt({ type: "text", message: "Paste code" });
        } catch (error) {
          promptRejected.resolve(toError(error));
          throw error;
        }
      }),
    });

    expect(state.prompt).toBeDefined();

    service.dispose();

    await expect(promptRejected.promise).resolves.toMatchObject({ message: "登录已取消" });
    expect(() => { service.get(state.flowId); }).toThrow("未找到 OAuth 登录流程");
  });

  it("rejects stale or duplicate responses", () => {
    const service = new OAuthLoginFlowService();
    const state = service.start({
      providerId: "test-provider",
      providerName: "Test Provider",
      modelRuntime: fakeModelRuntime(async (_providerId, _type, interaction) => {
        await interaction.prompt({ type: "text", message: "Paste code" });
      }),
    });

    const prompt = state.prompt;
    if (prompt === undefined) throw new Error("Expected prompt");

    service.respond(state.flowId, prompt.requestId, "abc123");
    expect(() => { service.respond(state.flowId, prompt.requestId, "abc123"); }).toThrow("OAuth 登录请求已过期");
    service.dispose();
  });

  it("expires abandoned running flows and evicts terminal flows", async () => {
    vi.useFakeTimers();
    const promptRejected = deferred<Error>();
    const service = new OAuthLoginFlowService({ runningTtlMs: 1000, terminalTtlMs: 1000 });
    const state = service.start({
      providerId: "test-provider",
      providerName: "Test Provider",
      modelRuntime: fakeModelRuntime(async (_providerId, _type, interaction) => {
        try {
          await interaction.prompt({ type: "text", message: "Paste code" });
        } catch (error) {
          promptRejected.resolve(toError(error));
          throw error;
        }
      }),
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(service.get(state.flowId)).toMatchObject({ status: "error", error: "OAuth 登录流程已过期" });
    await expect(promptRejected.promise).resolves.toMatchObject({ message: "OAuth 登录流程已过期" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(() => { service.get(state.flowId); }).toThrow("未找到 OAuth 登录流程");
    service.dispose();
  });
});

function fakeModelRuntime(login: LoginHandler) {
  return { login };
}

async function flushAsyncLogin(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolveValue: (value: T) => void = () => undefined;
  let rejectValue: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
