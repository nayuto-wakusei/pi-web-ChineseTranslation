import type { AuthInteraction } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthProvidersResponse, AuthType, OAuthFlowState } from "../../shared/apiTypes.js";
import { getLoginProviderOptions, getLogoutProviderOptions } from "./authProviderOptions.js";
import { OAuthLoginFlowService } from "./oauthLoginFlowService.js";

export interface AuthChange {
  modelRuntime: ModelRuntime;
  removedProviderId?: string;
}

type AuthChangeListener = (change: AuthChange) => void;

export interface AuthServiceDependencies {
  modelRuntime: ModelRuntime;
  authFlows?: OAuthLoginFlowService;
}

export class AuthService {
  readonly modelRuntime: ModelRuntime;
  private readonly authFlows: OAuthLoginFlowService;
  private readonly listeners = new Set<AuthChangeListener>();

  constructor(deps: AuthServiceDependencies) {
    this.modelRuntime = deps.modelRuntime;
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

  async authProviders(mode: "login" | "logout", authType?: AuthType): Promise<AuthProvidersResponse> {
    await this.modelRuntime.refresh();
    const providers = mode === "logout"
      ? await getLogoutProviderOptions(this.modelRuntime)
      : getLoginProviderOptions(this.modelRuntime, authType);
    return { providers };
  }

  async saveApiKey(providerId: string, key: string): Promise<{ accepted: true }> {
    if (key.trim() === "") throw new Error("API key is required");
    await this.modelRuntime.login(providerId, "api_key", apiKeyInteraction(key));
    this.emit({ modelRuntime: this.modelRuntime });
    return { accepted: true };
  }

  async logoutProvider(providerId: string): Promise<{ accepted: true }> {
    await this.modelRuntime.logout(providerId);
    this.emit({ modelRuntime: this.modelRuntime, removedProviderId: providerId });
    return { accepted: true };
  }

  startOAuthLogin(providerId: string): OAuthFlowState {
    const provider = this.requireOAuthLoginProvider(providerId);
    return this.authFlows.start({
      providerId,
      providerName: provider.name,
      modelRuntime: this.modelRuntime,
      onComplete: () => {
        this.emit({ modelRuntime: this.modelRuntime });
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

  private emit(change: AuthChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private requireOAuthLoginProvider(providerId: string) {
    const provider = getLoginProviderOptions(this.modelRuntime, "oauth").find((option) => option.id === providerId);
    if (provider === undefined) throw new Error(`OAuth provider not found: ${providerId}`);
    return provider;
  }
}

function apiKeyInteraction(key: string): AuthInteraction {
  return {
    prompt(prompt) {
      if (prompt.type === "select") return Promise.reject(new Error("此 API key 登录流程需要交互式选项，当前接口不支持"));
      return Promise.resolve(key);
    },
    notify() {
      // API-key login events do not need to be forwarded to the browser.
    },
  };
}
