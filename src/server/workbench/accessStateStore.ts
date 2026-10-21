import { loadNodeTranslator } from "../../localization.js";
import type { Translator } from "../../shared/i18n.js";
import type { WorkbenchAgentAccessState } from "./types.js";
import type { WorkbenchClient } from "./workbenchClient.js";

export class WorkbenchAccessStateStore {
  private readonly states = new Map<string, WorkbenchAgentAccessState>();
  private readonly refreshes = new Map<string, Promise<WorkbenchAgentAccessState>>();

  constructor(private readonly t: Translator = loadNodeTranslator("server")) {}

  set(handle: string, state: WorkbenchAgentAccessState): void {
    if (handle.trim() === "") throw new Error("Workbench access handle is required");
    if (!Number.isFinite(Date.parse(state.expiresAt))) throw new Error("Workbench access state expiry is invalid");
    const current = this.states.get(handle);
    if (current?.sessionId === state.sessionId && (
      current.authorizationRevision > state.authorizationRevision
      || (current.authorizationRevision === state.authorizationRevision && Date.parse(current.expiresAt) >= Date.parse(state.expiresAt))
    )) return;
    this.states.set(handle, state);
  }

  require(handle: string | undefined, t: Translator = loadNodeTranslator("server")): WorkbenchAgentAccessState {
    if (handle === undefined) throw new Error(this.t("workbench.authorizationMissing", "This management session has no Workbench resource authorization. Reopen the assistant from Workbench."));
    const state = this.states.get(handle);
    if (state === undefined || Date.parse(state.expiresAt) <= Date.now()) {
      throw new Error(t("workbench.authorizationExpired", "Resource authorization has expired or changed. Reopen the assistant from Workbench."));
    }
    return state;
  }

  async prepare(handle: string | undefined, client: WorkbenchClient, t: Translator = loadNodeTranslator("server")): Promise<WorkbenchAgentAccessState> {
    if (handle === undefined) throw new Error(t("workbench.authorizationMissing", "This management session has no Workbench resource authorization. Reopen the assistant from Workbench."));
    const state = this.states.get(handle);
    if (state === undefined) throw new Error(t("workbench.authorizationMissing", "This management session has no Workbench resource authorization. Reopen the assistant from Workbench."));
    const existing = this.refreshes.get(handle);
    if (existing !== undefined) return existing;
    const pending = client.refreshAgentAccessState(state).then((renewed) => {
      const current = this.states.get(handle);
      if (current?.sessionId !== state.sessionId || current.bearerToken !== state.bearerToken) throw new Error("Workbench access state changed during renewal; try again");
      this.set(handle, renewed);
      return this.require(handle);
    }).finally(() => {
      if (this.refreshes.get(handle) === pending) this.refreshes.delete(handle);
    });
    this.refreshes.set(handle, pending);
    return pending;
  }

  delete(handle: string): void {
    this.states.delete(handle);
  }

  clear(): void {
    this.states.clear();
  }
}
