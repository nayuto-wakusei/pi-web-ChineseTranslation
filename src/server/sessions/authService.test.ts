import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import type { OAuthFlowState } from "../../shared/apiTypes.js";
import { AuthService, type AuthChange } from "./authService.js";
import { createTestModelRuntime } from "./modelRuntime.testSupport.js";
import { OAuthLoginFlowService } from "./oauthLoginFlowService.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AuthService", () => {
  it("saves API keys and emits a scoped auth change", async () => {
    const { auth, credentials, changes } = await createAuthService();

    await expect(auth.saveApiKey("anthropic", "sk-test")).resolves.toEqual({ accepted: true });

    await expect(credentials.read("anthropic")).resolves.toEqual({ type: "api_key", key: "sk-test" });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ modelRuntime: auth.modelRuntime });
    auth.dispose();
  });

  it("logs out providers and emits the removed provider id", async () => {
    const { auth, credentials, changes } = await createAuthService({ anthropic: { type: "api_key", key: "sk-test" } });

    await expect(auth.logoutProvider("anthropic")).resolves.toEqual({ accepted: true });

    await expect(credentials.read("anthropic")).resolves.toBeUndefined();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ modelRuntime: auth.modelRuntime, removedProviderId: "anthropic" });
    auth.dispose();
  });

  it("rejects blank API keys", async () => {
    const { auth, changes } = await createAuthService();

    await expect(auth.saveApiKey("anthropic", "   ")).rejects.toThrow("API key is required");
    expect(changes).toEqual([]);
    auth.dispose();
  });

  it("stores credentials in the configured agent directory", async () => {
    const agentDir = await tempAgentDir();
    const auth = new AuthService({ modelRuntime: await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false }) });

    await auth.saveApiKey("anthropic", "sk-test");

    await expect(readFile(join(agentDir, "auth.json"), "utf8")).resolves.toContain("sk-test");
    auth.dispose();
  });

  it("emits the owning model runtime after OAuth login completes", async () => {
    const { modelRuntime } = await createTestModelRuntime();
    const authFlows = new CapturingOAuthLoginFlowService();
    const auth = new AuthService({ modelRuntime, authFlows });
    const changes: AuthChange[] = [];
    auth.subscribe((change) => { changes.push(change); });
    const provider = modelRuntime.getProviders().find((candidate) => candidate.id === "anthropic" && candidate.auth.oauth !== undefined);
    if (provider === undefined) throw new Error("Expected built-in OAuth provider");

    expect(auth.startOAuthLogin(provider.id)).toMatchObject({ providerId: provider.id, status: "running" });

    const startOptions = authFlows.startCalls.at(0);
    if (startOptions === undefined) throw new Error("Expected OAuth flow to start");
    expect(startOptions.providerId).toBe(provider.id);
    expect(startOptions.modelRuntime).toBe(modelRuntime);
    expect(changes).toEqual([]);

    if (startOptions.onComplete === undefined) throw new Error("Expected OAuth completion callback");
    startOptions.onComplete();

    expect(changes).toEqual([{ modelRuntime }]);
    auth.dispose();
    expect(authFlows.disposed).toBe(true);
  });
});

async function createAuthService(data: Record<string, Credential> = {}) {
  const { modelRuntime, credentials } = await createTestModelRuntime(data);
  const auth = new AuthService({ modelRuntime });
  const changes: AuthChange[] = [];
  auth.subscribe((change) => { changes.push(change); });
  return { auth, credentials, changes };
}

async function tempAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-auth-agent-"));
  tempDirs.push(dir);
  return dir;
}

class CapturingOAuthLoginFlowService extends OAuthLoginFlowService {
  readonly startCalls: Parameters<OAuthLoginFlowService["start"]>[0][] = [];
  disposed = false;

  override start(options: Parameters<OAuthLoginFlowService["start"]>[0]): OAuthFlowState {
    this.startCalls.push(options);
    return { flowId: "flow-1", providerId: options.providerId, providerName: options.providerName, status: "running", progress: [] };
  }

  override dispose(): void {
    this.disposed = true;
  }
}
