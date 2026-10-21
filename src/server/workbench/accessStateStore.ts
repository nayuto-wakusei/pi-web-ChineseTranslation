import type { WorkbenchAgentAccessState } from "./types.js";
import { loadNodeTranslator } from "../../localization.js";
import type { Translator } from "../../shared/i18n.js";

export class WorkbenchAccessStateStore {
  private readonly states = new Map<string, WorkbenchAgentAccessState>();

  constructor(private readonly t: Translator = loadNodeTranslator("server")) {}

  set(handle: string, state: WorkbenchAgentAccessState): void {
    if (handle.trim() === "") throw new Error("Workbench access handle is required");
    if (!Number.isFinite(Date.parse(state.expiresAt))) throw new Error("Workbench access state expiry is invalid");
    this.states.set(handle, state);
  }

  require(handle: string | undefined): WorkbenchAgentAccessState {
    if (handle === undefined) throw new Error(this.t("workbench.authorizationMissing", "This management session has no Workbench resource authorization. Reopen the assistant from Workbench."));
    const state = this.states.get(handle);
    if (state === undefined || Date.parse(state.expiresAt) <= Date.now()) {
      this.states.delete(handle);
      throw new Error(this.t("workbench.authorizationExpired", "Resource authorization has expired or changed. Reopen the assistant from Workbench."));
    }
    return state;
  }

  delete(handle: string): void {
    this.states.delete(handle);
  }

  clear(): void {
    this.states.clear();
  }
}
