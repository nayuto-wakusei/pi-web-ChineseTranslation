import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AuthProvidersResponse, AuthType, OAuthFlowState } from "../../shared/apiTypes.js";
import type { AuthScope } from "../realtime/sessionEventScope.js";
import { getLoginProviderOptions, getLogoutProviderOptions } from "./authProviderOptions.js";
import { OAuthLoginFlowService } from "./oauthLoginFlowService.js";

export interface AuthChange {
  scope: AuthScope;
  removedProviderId?: string;
}

type AuthChangeListener = (change: AuthChange) => void;
type ModelRegistryInstance = ReturnType<typeof ModelRegistry.create>;

export interface AuthServiceDependencies {
  scope?: AuthScope;
  modelRegistry?: ModelRegistryInstance;
  authFlows?: OAuthLoginFlowService;
}

export class AuthService {
  readonly modelRegistry: ModelRegistryInstance;
  private readonly authFlows: OAuthLoginFlowService;
  private readonly scope: AuthScope;
  private readonly listeners = new Set<AuthChangeListener>();

  constructor(deps: AuthServiceDependencies = {}) {
    this.scope = deps.scope ?? "normal";
    this.modelRegistry = deps.modelRegistry ?? ModelRegistry.create(AuthStorage.create());
    this.authFlows = deps.authFlows ?? new OAuthLoginFlowService();
  }

  subscribe(listener: AuthChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.authFlows.dispose();
    this.listeners.clear();
  }

  authProviders(mode: "login" | "logout", authType?: AuthType): AuthProvidersResponse {
    this.modelRegistry.refresh();
    const providers = mode === "logout" ? getLogoutProviderOptions(this.modelRegistry) : getLoginProviderOptions(this.modelRegistry, authType);
    return { providers };
  }

  saveApiKey(providerId: string, key: string): { accepted: true } {
    if (key.trim() === "") throw new Error("API key is required");
    this.modelRegistry.authStorage.set(providerId, { type: "api_key", key });
    this.refreshAuthState();
    return { accepted: true };
  }

  logoutProvider(providerId: string): { accepted: true } {
    this.modelRegistry.authStorage.logout(providerId);
    this.refreshAuthState({ removedProviderId: providerId });
    return { accepted: true };
  }

  startOAuthLogin(providerId: string): OAuthFlowState {
    const provider = this.requireOAuthLoginProvider(providerId);
    return this.authFlows.start({
      providerId,
      providerName: provider.name,
      authStorage: this.modelRegistry.authStorage,
      onComplete: () => {
        this.refreshAuthState();
      },
    });
  }

  oauthFlow(flowId: string): OAuthFlowState {
    return this.authFlows.get(flowId);
  }

  respondToOAuthFlow(flowId: string, requestId: string, value: string): OAuthFlowState {
    return this.authFlows.respond(flowId, requestId, value);
  }

  cancelOAuthFlow(flowId: string): OAuthFlowState {
    return this.authFlows.cancel(flowId);
  }

  private refreshAuthState(change: Partial<Omit<AuthChange, "scope">> = {}): void {
    this.modelRegistry.authStorage.reload();
    this.modelRegistry.refresh();
    this.emit({ scope: this.scope, ...change });
  }

  private emit(change: AuthChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private requireOAuthLoginProvider(providerId: string) {
    this.modelRegistry.refresh();
    const provider = getLoginProviderOptions(this.modelRegistry, "oauth").find((option) => option.id === providerId);
    if (provider === undefined) throw new Error(`OAuth provider not found: ${providerId}`);
    return provider;
  }
}
