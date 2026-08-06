import type { WorkbenchAgentAccessState } from "./types.js";

export class WorkbenchAccessStateStore {
  private readonly states = new Map<string, WorkbenchAgentAccessState>();

  set(handle: string, state: WorkbenchAgentAccessState): void {
    if (handle.trim() === "") throw new Error("Workbench access handle is required");
    if (!Number.isFinite(Date.parse(state.expiresAt))) throw new Error("Workbench access state expiry is invalid");
    this.states.set(handle, state);
  }

  require(handle: string | undefined): WorkbenchAgentAccessState {
    if (handle === undefined) throw new Error("当前管理会话没有工作台资源授权，请从工作台重新进入桂小智。");
    const state = this.states.get(handle);
    if (state === undefined || Date.parse(state.expiresAt) <= Date.now()) {
      this.states.delete(handle);
      throw new Error("当前资源授权已过期或发生变化，请返回工作台重新进入桂小智。");
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
