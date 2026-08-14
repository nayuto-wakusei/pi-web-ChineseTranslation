import { randomUUID } from "node:crypto";
import { CORE_STATUS_FLAGS, rollUpStatusFlags, type MachineStatusSnapshot, type StatusFlags } from "../../shared/machineStatus.js";
import { NORMAL_SESSION_EVENT_SCOPE, type SessionEventScope } from "../realtime/sessionEventScope.js";
import type { WorkspaceAttribution } from "./workspaceAttribution.js";

export interface ActiveCwdActivity { cwd: string; hasSessionActivity: boolean; hasTerminalActivity: boolean; }
interface ActivitySource { activeSnapshot(scope?: SessionEventScope): { workspaces: readonly ActiveCwdActivity[] }; }
interface UnreadSource { catalogSnapshot(scope?: SessionEventScope): { sessions: readonly { cwd: string }[] } | Promise<{ sessions: readonly { cwd: string }[] }>; }
interface Publisher { publish(snapshot: MachineStatusSnapshot, scope: SessionEventScope): void; }
interface Logger { warn(details: Record<string, unknown>, message: string): void; }

export interface MachineStatusServiceDependencies {
  activity: ActivitySource;
  unread: UnreadSource;
  attribution: Pick<WorkspaceAttribution, "attribute">;
  publisher: Publisher;
  logger: Logger;
}

type MachineStatusTree = Pick<MachineStatusSnapshot, "machine" | "projects" | "workspaces" | "unattributed">;

export class MachineStatusService {
  private readonly epochId = randomUUID();
  private readonly states = new Map<SessionEventScope, MachineStatusSnapshot>();
  private readonly pending = new Set<SessionEventScope>();
  private readonly running = new Map<SessionEventScope, Promise<void>>();

  constructor(private readonly dependencies: MachineStatusServiceDependencies) {}

  snapshot(scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): MachineStatusSnapshot {
    const current = this.states.get(scope);
    if (current !== undefined) return current;
    const initial: MachineStatusSnapshot = {
      epochId: this.epochId, revision: 0, machine: {}, projects: {}, workspaces: {}, unattributed: {}, generatedAt: new Date().toISOString(),
    };
    this.states.set(scope, initial);
    return initial;
  }

  notifyChanged(scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): void { void this.refresh(scope); }

  refresh(scope: SessionEventScope = NORMAL_SESSION_EVENT_SCOPE): Promise<void> {
    this.pending.add(scope);
    const existing = this.running.get(scope);
    if (existing !== undefined) return existing;
    const run = this.runUntilSettled(scope);
    this.running.set(scope, run);
    return run;
  }

  private async runUntilSettled(scope: SessionEventScope): Promise<void> {
    try {
      while (this.pending.delete(scope)) await this.publishIfChanged(scope);
    } finally {
      this.running.delete(scope);
    }
  }

  private async publishIfChanged(scope: SessionEventScope): Promise<void> {
    let tree: MachineStatusTree;
    try { tree = await this.computeTree(scope); }
    catch (error) { this.dependencies.logger.warn({ err: error, scope }, "machine status projection could not be recomputed"); return; }
    const current = this.snapshot(scope);
    if (isSameStatusTree(tree, current)) return;
    const next: MachineStatusSnapshot = { epochId: current.epochId, revision: current.revision + 1, ...tree, generatedAt: new Date().toISOString() };
    this.states.set(scope, next);
    try { this.dependencies.publisher.publish(next, scope); }
    catch (error) { this.dependencies.logger.warn({ err: error, scope }, "machine status projection could not be published"); }
  }

  private async computeTree(scope: SessionEventScope): Promise<MachineStatusTree> {
    const flagsByCwd = await this.flagsByCwd(scope);
    const attributions = await this.dependencies.attribution.attribute(flagsByCwd.keys());
    const projects = new FlagAccumulator();
    const workspaces = new FlagAccumulator();
    const unattributed: StatusFlags[] = [];
    for (const [cwd, flags] of flagsByCwd) {
      const attribution = attributions.get(cwd);
      if (attribution === undefined) unattributed.push(flags);
      else { projects.add(attribution.projectId, flags); workspaces.add(attribution.workspaceId, flags); }
    }
    const rolledProjects = projects.rollUp();
    const rolledWorkspaces = workspaces.rollUp();
    const rolledUnattributed = rollUpStatusFlags(unattributed);
    return { machine: rollUpStatusFlags([...Object.values(rolledProjects), ...Object.values(rolledWorkspaces), rolledUnattributed]), projects: rolledProjects, workspaces: rolledWorkspaces, unattributed: rolledUnattributed };
  }

  private async flagsByCwd(scope: SessionEventScope): Promise<Map<string, StatusFlags>> {
    const flagsByCwd = new Map<string, Record<string, boolean>>();
    const setFlag = (cwd: string, flagId: string): void => { if (cwd === "") return; const flags = flagsByCwd.get(cwd) ?? {}; flags[flagId] = true; flagsByCwd.set(cwd, flags); };
    for (const activity of this.dependencies.activity.activeSnapshot(scope).workspaces) {
      if (activity.hasSessionActivity) setFlag(activity.cwd, CORE_STATUS_FLAGS.working);
      if (activity.hasTerminalActivity) setFlag(activity.cwd, CORE_STATUS_FLAGS.terminal);
    }
    for (const session of (await this.dependencies.unread.catalogSnapshot(scope)).sessions) setFlag(session.cwd, CORE_STATUS_FLAGS.unread);
    return flagsByCwd;
  }
}

class FlagAccumulator {
  private readonly sourcesByNodeId = new Map<string, StatusFlags[]>();
  add(nodeId: string, flags: StatusFlags): void { const sources = this.sourcesByNodeId.get(nodeId) ?? []; sources.push(flags); this.sourcesByNodeId.set(nodeId, sources); }
  rollUp(): Record<string, StatusFlags> { return Object.fromEntries([...this.sourcesByNodeId].map(([id, sources]) => [id, rollUpStatusFlags(sources)])); }
}

function isSameStatusTree(left: MachineStatusTree, right: MachineStatusSnapshot): boolean {
  return isSameFlags(left.machine, right.machine) && isSameFlags(left.unattributed, right.unattributed) && isSameNodes(left.projects, right.projects) && isSameNodes(left.workspaces, right.workspaces);
}
function isSameNodes(left: Readonly<Record<string, StatusFlags>>, right: Readonly<Record<string, StatusFlags>>): boolean {
  const leftIds = Object.keys(left);
  return leftIds.length === Object.keys(right).length && leftIds.every((id) => right[id] !== undefined && isSameFlags(left[id] ?? {}, right[id] ?? {}));
}
function isSameFlags(left: StatusFlags, right: StatusFlags): boolean {
  const leftIds = Object.keys(left);
  return leftIds.length === Object.keys(right).length && leftIds.every((id) => left[id] === right[id]);
}
