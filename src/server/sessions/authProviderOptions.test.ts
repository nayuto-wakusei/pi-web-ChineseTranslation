import { describe, expect, it } from "vitest";
import { getLoginProviderOptions, getLogoutProviderOptions, isApiKeyLoginProvider, type AuthProviderModelRuntime } from "./authProviderOptions";

function modelRuntime(): AuthProviderModelRuntime {
  return {
    getProviders: () => [
      { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: true }, oauth: { name: "Anthropic (Claude Pro/Max)" } } },
      { id: "openai", name: "OpenAI", auth: { apiKey: { login: true } } },
      { id: "openai-codex", name: "OpenAI Codex", auth: { oauth: { name: "ChatGPT Plus/Pro (Codex Subscription)" } } },
      { id: "github-copilot", name: "GitHub Copilot", auth: { oauth: { name: "GitHub Copilot" } } },
      { id: "custom", name: "Custom", auth: { apiKey: { login: true } } },
    ],
    listCredentials: () => Promise.resolve([{ providerId: "openai", type: "api_key" }]),
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
    const options = getLoginProviderOptions(modelRuntime());
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "anthropic", authType: "oauth" }),
      expect.objectContaining({ id: "anthropic", authType: "api_key" }),
      expect.objectContaining({ id: "openai", authType: "api_key", status: { configured: true, source: "stored" } }),
      expect.objectContaining({ id: "openai-codex", authType: "oauth" }),
    ]));
    expect(options).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "openai-codex", authType: "api_key" })]));
  });

  it("returns only currently stored credentials for logout", async () => {
    expect(await getLogoutProviderOptions(modelRuntime())).toEqual([
      expect.objectContaining({ id: "openai", authType: "api_key" }),
    ]);
  });
});
