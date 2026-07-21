import { api as defaultApi, type ApiScope, type AuthProviderOption, type AuthType, type OAuthFlowState, type SessionStatus } from "../api";
import type { AuthDialogTarget } from "../appState";
import { selectedMachineId, type GetState, type SetState } from "./types";

export interface AuthControllerDependencies {
  api?: typeof defaultApi;
  pollIntervalMs?: number;
  scope: ApiScope;
}

export class AuthController {
  private readonly api: typeof defaultApi;
  private readonly pollIntervalMs: number;
  private readonly scope: ApiScope;
  private pollTimer: number | undefined;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly applyStatus: (status: SessionStatus) => void,
    deps: AuthControllerDependencies,
  ) {
    this.api = deps.api ?? defaultApi;
    this.pollIntervalMs = deps.pollIntervalMs ?? 1000;
    this.scope = deps.scope;
  }

  dispose(): void {
    this.stopPolling();
  }

  handleSlashCommand(text: string): boolean {
    const parsed = parseAuthSlashCommand(text);
    if (parsed === undefined) return false;
    if (parsed.command === "login") void this.openLogin(parsed.providerId);
    else void this.openLogout(parsed.providerId);
    return true;
  }

  async openLogin(providerId?: string): Promise<void> {
    const target = this.captureTarget();
    if (target === undefined) return;
    if (providerId !== undefined && providerId !== "") {
      await this.openLoginProvider(providerId, target);
      return;
    }
    this.setState({ authDialog: { step: "method", target } });
  }

  async chooseLoginMethod(authType: AuthType): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "method") return;
    try {
      const { providers } = await this.api.authProviders({ mode: "login", authType, ...dialog.target });
      this.setState({ authDialog: { step: "providers", mode: "login", authType, providers, target: dialog.target } });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async selectLoginProvider(providerId: string, authType?: AuthType): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "providers") return;
    const provider = dialog.providers.find((candidate) => candidate.id === providerId && (authType === undefined || candidate.authType === authType));
    if (provider === undefined) return;
    if (provider.authType === "oauth") await this.startOAuth(provider, dialog.target);
    else this.setState({ authDialog: { step: "apiKey", provider, value: "", target: dialog.target } });
  }

  updateApiKey(value: string): void {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "apiKey") return;
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, value } });
  }

  async saveApiKey(): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "apiKey") return;
    const key = dialog.value.trim();
    if (key === "") {
      this.setState({ authDialog: { ...dialog, error: "API key is required" } });
      return;
    }
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, saving: true } });
    try {
      const target = dialog.target;
      await this.api.saveApiKey(dialog.provider.id, key, target);
      this.closeDialog();
      void this.refreshStatus(target);
    } catch (error) {
      this.setState({ authDialog: { ...dialog, saving: false, error: String(error) } });
    }
  }

  async openLogout(providerId?: string): Promise<void> {
    const target = this.captureTarget();
    if (target === undefined) return;
    try {
      const { providers } = await this.api.authProviders({ mode: "logout", ...target });
      if (providerId !== undefined && providerId !== "") {
        const provider = providers.find((candidate) => candidate.id === providerId);
        if (provider !== undefined && !this.rejectRemoteOAuth("logout", provider, target)) await this.logoutProviderForTarget(provider.id, target);
        else if (provider === undefined) this.setState({ error: `No stored credentials for ${providerId}` });
        return;
      }
      this.setState({ authDialog: { step: "logout", providers, target } });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async logoutProvider(providerId: string): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "logout") return;
    const provider = dialog.providers.find((candidate) => candidate.id === providerId);
    if (provider === undefined || this.rejectRemoteOAuth("logout", provider, dialog.target)) return;
    await this.logoutProviderForTarget(providerId, dialog.target);
  }

  private async logoutProviderForTarget(providerId: string, target: AuthDialogTarget): Promise<void> {
    try {
      await this.api.logoutProvider(providerId, target);
      this.closeDialog();
      void this.refreshStatus(target);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  updateOAuthInput(value: string): void {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") return;
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, inputValue: value } });
  }

  async respondOAuth(value?: string): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") return;
    const request = dialog.flow.prompt ?? dialog.flow.select;
    if (request === undefined) return;
    const responseValue = value ?? dialog.inputValue ?? "";
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, responding: true } });
    try {
      const flow = await this.api.respondOAuthFlow(dialog.flow.flowId, request.requestId, responseValue, dialog.target);
      this.updateOAuthFlow(flow, dialog.target);
    } catch (error) {
      this.setState({ authDialog: { ...dialog, responding: false, error: String(error) } });
    }
  }

  async cancelOAuth(): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") {
      this.closeDialog();
      return;
    }
    this.stopPolling();
    try {
      await this.api.cancelOAuthFlow(dialog.flow.flowId, dialog.target);
    } catch {
      // Best-effort cancel. The dialog closes either way.
    }
    this.closeDialog();
  }

  closeDialog(): void {
    this.stopPolling();
    this.setState({ authDialog: undefined });
  }

  private async openLoginProvider(providerId: string, target: AuthDialogTarget): Promise<void> {
    try {
      const { providers } = await this.api.authProviders({ mode: "login", ...target });
      const exact = providers.filter((provider) => provider.id === providerId);
      if (exact.length === 0) {
        this.setState({ error: `Auth provider not found: ${providerId}` });
        return;
      }
      if (exact.length > 1) {
        this.setState({ authDialog: { step: "providers", mode: "login", providers: exact, target } });
        return;
      }
      const provider = exact[0];
      if (provider === undefined) return;
      if (provider.authType === "oauth") await this.startOAuth(provider, target);
      else this.setState({ authDialog: { step: "apiKey", provider, value: "", target } });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private async startOAuth(provider: AuthProviderOption, target: AuthDialogTarget): Promise<void> {
    if (this.rejectRemoteOAuth("login", provider, target)) return;
    try {
      const flow = await this.api.startOAuthLogin(provider.id, target);
      this.updateOAuthFlow(flow, target);
      this.startPolling(flow.flowId);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private rejectRemoteOAuth(action: "login" | "logout", provider: AuthProviderOption, target: AuthDialogTarget): boolean {
    const machine = this.getState().selectedMachine;
    if (provider.authType !== "oauth" || target.machineKind !== "remote") return false;
    const where = machine?.baseUrl ?? "that remote PI WEB instance";
    this.setState({ error: `OAuth ${action} for remote machines must be configured directly on ${where}.` });
    return true;
  }

  private updateOAuthFlow(flow: OAuthFlowState, target: AuthDialogTarget): void {
    if (flow.status === "complete") {
      this.stopPolling();
      this.closeDialog();
      void this.refreshStatus(target);
      return;
    }
    if (flow.status === "error" || flow.status === "cancelled") this.stopPolling();
    const existing = this.getState().authDialog;
    const previousInput = existing?.step === "oauth" && existing.flow.flowId === flow.flowId ? existing.inputValue ?? "" : "";
    const previousRequestId = existing?.step === "oauth" ? existing.flow.prompt?.requestId ?? existing.flow.select?.requestId : undefined;
    const newRequestId = flow.prompt?.requestId ?? flow.select?.requestId;
    const sameRequest = previousRequestId !== undefined && previousRequestId === newRequestId;
    const inputValue = sameRequest ? previousInput : "";
    const responding = sameRequest && existing?.step === "oauth" ? existing.responding === true : false;
    this.setState({ authDialog: { step: "oauth", flow, inputValue, responding, target } });
  }

  private startPolling(flowId: string): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => { void this.poll(flowId); }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async poll(flowId: string): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth" || dialog.flow.flowId !== flowId) {
      this.stopPolling();
      return;
    }
    try {
      this.updateOAuthFlow(await this.api.oauthFlow(flowId, dialog.target), dialog.target);
    } catch (error) {
      this.stopPolling();
      this.setState({ authDialog: { ...dialog, error: String(error) } });
    }
  }

  private async refreshStatus(target: AuthDialogTarget): Promise<void> {
    const session = this.session();
    if (session === undefined) return;
    if (!this.targetStillSelected(target)) return;
    try {
      this.applyStatus(await this.api.status(session, target.machineId));
    } catch {
      // Status refresh is opportunistic after login completes.
    }
  }

  private session() {
    const session = this.getState().selectedSession;
    if (session === undefined || session.archived === true) return undefined;
    return session;
  }

  private captureTarget(): AuthDialogTarget | undefined {
    const state = this.getState();
    const machine = state.selectedMachine;
    const target: AuthDialogTarget = {
      machineId: selectedMachineId(state),
      ...(machine?.kind === undefined ? {} : { machineKind: machine.kind }),
    };
    if (this.scope === "management") return target;
    const project = state.selectedProject;
    if (project === undefined) {
      this.setState({ error: "请先选择项目，再配置提供商认证。" });
      return undefined;
    }
    return { ...target, projectId: project.id, projectName: project.name };
  }

  private targetStillSelected(target: AuthDialogTarget): boolean {
    if (selectedMachineId(this.getState()) !== target.machineId) return false;
    return target.projectId === undefined || this.getState().selectedProject?.id === target.projectId;
  }
}

export function parseAuthSlashCommand(text: string): { command: "login" | "logout"; providerId?: string } | undefined {
  const trimmed = text.trim();
  const match = /^\/(login|logout)(?:\s+(\S+))?\s*$/u.exec(trimmed);
  if (match === null) return undefined;
  const command = match[1];
  if (command !== "login" && command !== "logout") return undefined;
  const providerId = match[2];
  return providerId === undefined || providerId === "" ? { command } : { command, providerId };
}

export type { AuthDialogState } from "../appState";
