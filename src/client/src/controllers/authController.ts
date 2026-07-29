import { api as defaultApi, type ApiScope, type AuthProviderOption, type AuthRequestTarget, type AuthType, type OAuthFlowState, type SessionStatus } from "../api";
import type { AuthDialogState, AuthDialogTarget } from "../appState";
import { selectedMachineId, type GetState, type SetState } from "./types";

type OAuthDialogState = Extract<AuthDialogState, { step: "oauth" }>;

export interface AuthControllerDependencies {
  api?: typeof defaultApi;
  pollIntervalMs?: number;
  scope: ApiScope;
}

export class AuthController {
  private readonly api: typeof defaultApi;
  private readonly pollIntervalMs: number;
  private readonly scope: ApiScope;
  private oauthOperationGeneration = 0;
  private pollGeneration = 0;
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
    this.oauthOperationGeneration += 1;
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
      const { providers } = await this.api.authProviders({ mode: "login", authType, ...authRequestTarget(dialog.target) });
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
    if (provider.authType === "oauth" || provider.loginFlow === "interactive") await this.startOAuth(provider, dialog.target);
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
      const { providers } = await this.api.authProviders({ mode: "logout", ...authRequestTarget(target) });
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
    const operationGeneration = this.oauthOperationGeneration;
    const flowId = dialog.flow.flowId;
    const requestId = request.requestId;
    const responseValue = value ?? dialog.inputValue ?? "";
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, responding: true } });
    try {
      const flow = await this.api.respondOAuthFlow(dialog.flow.flowId, request.requestId, responseValue, dialog.target);
      this.updateOAuthFlow(flow, dialog.target);
    } catch (error) {
      const current = this.currentOAuthDialog(operationGeneration, flowId);
      if (current === undefined || oauthRequestId(current.flow) !== requestId) return;
      this.setState({ authDialog: { ...current, responding: false, error: String(error) } });
    }
  }

  async cancelOAuth(): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") {
      this.closeDialog();
      return;
    }
    const flowId = dialog.flow.flowId;
    const target = dialog.target;
    this.closeDialog();
    try {
      await this.api.cancelOAuthFlow(flowId, target);
    } catch {
      // Best-effort cancel. The dialog is already closed either way.
    }
  }

  closeDialog(): void {
    this.oauthOperationGeneration += 1;
    this.stopPolling();
    this.setState({ authDialog: undefined });
  }

  private async openLoginProvider(providerId: string, target: AuthDialogTarget): Promise<void> {
    try {
      const { providers } = await this.api.authProviders({ mode: "login", ...authRequestTarget(target) });
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
      if (provider.authType === "oauth" || provider.loginFlow === "interactive") await this.startOAuth(provider, target);
      else this.setState({ authDialog: { step: "apiKey", provider, value: "", target } });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private async startOAuth(provider: AuthProviderOption, target: AuthDialogTarget): Promise<void> {
    if (this.rejectRemoteOAuth("login", provider, target)) return;
    const operationGeneration = ++this.oauthOperationGeneration;
    this.stopPolling();
    try {
      const flow = provider.authType === "oauth"
        ? await this.api.startOAuthLogin(provider.id, target)
        : await this.api.startInteractiveApiKeyLogin(provider.id, target);
      if (operationGeneration !== this.oauthOperationGeneration) {
        if (flow.status === "running") {
          try {
            await this.api.cancelOAuthFlow(flow.flowId, target);
          } catch {
            // Best-effort cleanup for a stale UI operation.
          }
        }
        return;
      }
      this.updateOAuthFlow(flow, target);
      if (flow.status === "running") this.startPolling(flow.flowId, target);
    } catch (error) {
      if (operationGeneration === this.oauthOperationGeneration) this.setState({ error: String(error) });
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
    if (flow.status === "error" || flow.status === "cancelled") {
      this.oauthOperationGeneration += 1;
      this.stopPolling();
    }
    const existing = this.getState().authDialog;
    const previousInput = existing?.step === "oauth" && existing.flow.flowId === flow.flowId ? existing.inputValue ?? "" : "";
    const previousRequestId = existing?.step === "oauth" ? oauthRequestId(existing.flow) : undefined;
    const newRequestId = oauthRequestId(flow);
    const sameRequest = previousRequestId !== undefined && previousRequestId === newRequestId;
    const inputValue = sameRequest ? previousInput : "";
    const responding = sameRequest && existing?.step === "oauth" ? existing.responding === true : false;
    this.setState({ authDialog: { step: "oauth", flow, inputValue, responding, target } });
  }

  private startPolling(flowId: string, target: AuthDialogTarget): void {
    this.stopPolling();
    const operationGeneration = this.oauthOperationGeneration;
    const pollGeneration = this.pollGeneration;
    this.pollTimer = window.setInterval(() => { void this.poll(flowId, target, operationGeneration, pollGeneration); }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    this.pollGeneration += 1;
    if (this.pollTimer === undefined) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async poll(flowId: string, target: AuthDialogTarget, operationGeneration: number, pollGeneration: number): Promise<void> {
    if (pollGeneration !== this.pollGeneration) return;
    const dialog = this.currentOAuthDialog(operationGeneration, flowId);
    if (dialog === undefined || !sameAuthTarget(dialog.target, target)) {
      this.stopPolling();
      return;
    }
    const requestId = oauthRequestId(dialog.flow);
    try {
      this.updateOAuthFlow(await this.api.oauthFlow(flowId, dialog.target), dialog.target);
    } catch (error) {
      const current = this.currentOAuthDialog(operationGeneration, flowId);
      if (pollGeneration !== this.pollGeneration || current === undefined || !sameAuthTarget(current.target, target) || oauthRequestId(current.flow) !== requestId) return;
      this.stopPolling();
      this.setState({ authDialog: { ...current, error: String(error) } });
    }
  }

  private currentOAuthDialog(operationGeneration: number, flowId: string): OAuthDialogState | undefined {
    if (operationGeneration !== this.oauthOperationGeneration) return undefined;
    const dialog = this.getState().authDialog;
    return dialog?.step === "oauth" && dialog.flow.flowId === flowId ? dialog : undefined;
  }

  private async refreshStatus(target: AuthDialogTarget): Promise<void> {
    const session = this.selectedSessionForMachine(target.machineId);
    if (session === undefined) return;
    if (!this.targetStillSelected(target)) return;
    try {
      this.applyStatus(await this.api.status(session, target.machineId));
    } catch {
      // Status refresh is opportunistic after login completes.
    }
  }

  private selectedSessionForMachine(machineId: string) {
    const state = this.getState();
    if (selectedMachineId(state) !== machineId) return undefined;
    const session = state.selectedSession;
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

function sameAuthTarget(left: AuthDialogTarget, right: AuthDialogTarget): boolean {
  return left.machineId === right.machineId && left.projectId === right.projectId;
}

function authRequestTarget(target: AuthDialogTarget): AuthRequestTarget {
  return target.projectId === undefined
    ? { machineId: target.machineId }
    : {
        machineId: target.machineId,
        projectId: target.projectId,
        ...(target.projectName === undefined ? {} : { projectName: target.projectName }),
      };
}

function oauthRequestId(flow: OAuthFlowState): string | undefined {
  return flow.prompt?.requestId ?? flow.select?.requestId;
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
