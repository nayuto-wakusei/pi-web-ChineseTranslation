import { describe, expect, it } from "vitest";
import { getLoginProviderOptions, getLogoutProviderOptions, isApiKeyLoginProvider, type AuthProviderModelRegistry } from "./authProviderOptions";

function registry(): AuthProviderModelRegistry {
  const credentials = new Map<string, { type: "oauth" | "api_key" }>();
  credentials.set("openai", { type: "api_key" });
  return {
    authStorage: {
      getOAuthProviders: () => [
        { id: "anthropic", name: "Anthropic (Claude Pro/Max)" },
        { id: "github-copilot", name: "GitHub Copilot" },
        { id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)" },
      ],
      list: () => Array.from(credentials.keys()),
      get: (provider: string) => credentials.get(provider),
    },
    getAll: () => [
      { provider: "anthropic" },
      { provider: "openai" },
      { provider: "openai-codex" },
      { provider: "github-copilot" },
      { provider: "custom" },
    ],
    getProviderDisplayName: (provider: string) => ({ anthropic: "Anthropic", openai: "OpenAI", custom: "Custom" }[provider] ?? provider),
    getProviderAuthStatus: (provider: string) => (provider === "openai" ? { configured: true, source: "stored" } : { configured: false }),
  };
}

describe("auth provider options", () => {
  it("keeps OAuth-only providers out of API key login options", () => {
    expect(isApiKeyLoginProvider("openai-codex", new Set(["openai-codex"]))).toBe(false);
    expect(isApiKeyLoginProvider("github-copilot", new Set(["github-copilot"]))).toBe(false);
    expect(isApiKeyLoginProvider("openai", new Set(["openai-codex"]))).toBe(true);
  });

  it("builds login options for OAuth-only, dual-auth, and API-key providers", () => {
    const options = getLoginProviderOptions(registry());
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "anthropic", authType: "oauth" }),
      expect.objectContaining({ id: "anthropic", authType: "api_key" }),
      expect.objectContaining({ id: "openai", authType: "api_key", status: { configured: true, source: "stored" } }),
      expect.objectContaining({ id: "openai-codex", authType: "oauth" }),
    ]));
    expect(options).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "openai-codex", authType: "api_key" })]));
  });

  it("returns only currently stored credentials for logout", () => {
    expect(getLogoutProviderOptions(registry())).toEqual([
      expect.objectContaining({ id: "openai", authType: "api_key" }),
    ]);
  });
});
