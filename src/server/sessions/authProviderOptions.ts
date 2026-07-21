import type { AuthProviderOption, AuthProviderStatus, AuthType } from "../../shared/apiTypes.js";

const OAUTH_ONLY_PROVIDERS = new Set(["github-copilot", "openai-codex"]);

export interface AuthProviderModelRuntime {
  getProviders(): readonly {
    id: string;
    name: string;
    auth: {
      apiKey?: { login?: unknown };
      oauth?: { name: string };
    };
  }[];
  listCredentials(): Promise<readonly { providerId: string; type: AuthType }[]>;
  getProviderAuthStatus(provider: string): AuthProviderStatus;
}

export function getLoginProviderOptions(modelRuntime: AuthProviderModelRuntime, authType?: AuthType): AuthProviderOption[] {
  const providers = modelRuntime.getProviders();
  const oauthProviderIds = new Set(providers.filter((provider) => provider.auth.oauth !== undefined).map((provider) => provider.id));
  const options: AuthProviderOption[] = [];
  for (const provider of providers) {
    if (provider.auth.oauth !== undefined) {
      options.push({
        id: provider.id,
        name: provider.auth.oauth.name,
        authType: "oauth",
        status: modelRuntime.getProviderAuthStatus(provider.id),
      });
    }
    if (provider.auth.apiKey?.login === undefined || !isApiKeyLoginProvider(provider.id, oauthProviderIds)) continue;
    options.push({
      id: provider.id,
      name: provider.name,
      authType: "api_key",
      status: modelRuntime.getProviderAuthStatus(provider.id),
    });
  }

  return filterAndSort(options, authType);
}

export async function getLogoutProviderOptions(modelRuntime: AuthProviderModelRuntime): Promise<AuthProviderOption[]> {
  const options: AuthProviderOption[] = [];
  const providers = new Map(modelRuntime.getProviders().map((provider) => [provider.id, provider]));
  for (const credential of await modelRuntime.listCredentials()) {
    const providerId = credential.providerId;
    options.push({
      id: providerId,
      name: providers.get(providerId)?.name ?? providerId,
      authType: credential.type,
      status: modelRuntime.getProviderAuthStatus(providerId),
    });
  }
  return filterAndSort(options);
}

export function isApiKeyLoginProvider(providerId: string, oauthProviderIds: ReadonlySet<string>): boolean {
  if (OAUTH_ONLY_PROVIDERS.has(providerId)) return false;
  if (providerId === "anthropic") return true;
  if (oauthProviderIds.has(providerId)) return false;
  return true;
}

function filterAndSort(options: AuthProviderOption[], authType?: AuthType): AuthProviderOption[] {
  const filtered = authType === undefined ? options : options.filter((option) => option.authType === authType);
  return filtered.sort((a, b) => a.name.localeCompare(b.name) || a.authType.localeCompare(b.authType) || a.id.localeCompare(b.id));
}
