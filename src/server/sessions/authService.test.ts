import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { AuthService, type AuthChange } from "./authService.js";

describe("AuthService", () => {
  it("saves API keys and emits a global auth change", () => {
    const { auth, authStorage, changes } = createAuthService();

    expect(auth.saveApiKey("anthropic", "sk-test")).toEqual({ accepted: true });

    expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "sk-test" });
    expect(changes).toEqual([{ scope: "normal" }]);
    auth.dispose();
  });

  it("logs out providers and emits the removed provider id", () => {
    const { auth, authStorage, changes } = createAuthService({ anthropic: { type: "api_key", key: "sk-test" } });

    expect(auth.logoutProvider("anthropic")).toEqual({ accepted: true });

    expect(authStorage.get("anthropic")).toBeUndefined();
    expect(changes).toEqual([{ scope: "normal", removedProviderId: "anthropic" }]);
    auth.dispose();
  });

  it("rejects blank API keys", () => {
    const { auth, changes } = createAuthService();

    expect(() => { auth.saveApiKey("anthropic", "   "); }).toThrow("API key is required");
    expect(changes).toEqual([]);
    auth.dispose();
  });
});

function createAuthService(data: Parameters<typeof AuthStorage.inMemory>[0] = {}) {
  const authStorage = AuthStorage.inMemory(data);
  const modelRegistry = ModelRegistry.create(authStorage);
  const auth = new AuthService({ modelRegistry });
  const changes: AuthChange[] = [];
  auth.subscribe((change) => { changes.push(change); });
  return { auth, authStorage, changes };
}
