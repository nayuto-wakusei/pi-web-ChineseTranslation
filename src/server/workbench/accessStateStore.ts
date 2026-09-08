import type { WorkbenchAgentAccessState } from "./types.js";
import type { WorkbenchClient } from "./workbenchClient.js";

export class WorkbenchAccessStateStore {
  private readonly states = new Map<string, WorkbenchAgentAccessState>();
  private readonly refreshes = new Map<string, Promise<WorkbenchAgentAccessState>>();

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

  require(handle: string | undefined): WorkbenchAgentAccessState {
    if (handle === undefined) throw new Error("当前管理会话没有工作台资源授权，请从工作台重新进入桂小智。");
    const state = this.states.get(handle);
    if (state === undefined || Date.parse(state.expiresAt) <= Date.now()) {
      throw new Error("当前资源授权已过期或发生变化，请返回工作台重新进入桂小智。");
    }
    return state;
  }

  async prepare(handle: string | undefined, client: WorkbenchClient): Promise<WorkbenchAgentAccessState> {
    if (handle === undefined) throw new Error("当前管理会话没有工作台资源授权，请从工作台重新进入桂小智。");
    const state = this.states.get(handle);
    if (state === undefined) throw new Error("当前管理会话没有工作台资源授权，请从工作台重新进入桂小智。");
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
