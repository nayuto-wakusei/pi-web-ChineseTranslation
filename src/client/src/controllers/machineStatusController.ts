import { machineStatusApi as defaultApi } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import type { GetState, SetState } from "./types";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";

export interface MachineStatusApi {
  machineStatus(machineId: string): Promise<MachineStatusSnapshot>;
}

export interface MachineStatusControllerDependencies { api?: MachineStatusApi; }

export class MachineStatusController {
  private readonly api: MachineStatusApi;
  private readonly refreshes = new TrailingRefreshCoordinator<string>();

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    deps: MachineStatusControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
  }

  refresh(machineId: string): Promise<void> {
    return this.refreshes.request(machineId, async () => {
      this.apply(machineId, await this.api.machineStatus(machineId));
    });
  }

  apply(machineId: string, snapshot: MachineStatusSnapshot): void {
    const snapshots = this.getState().machineStatusSnapshots;
    if (!supersedes(snapshots[machineId], snapshot)) return;
    this.setState({ machineStatusSnapshots: { ...snapshots, [machineId]: snapshot } });
  }
}

function supersedes(current: MachineStatusSnapshot | undefined, candidate: MachineStatusSnapshot): boolean {
  if (current === undefined) return true;
  return current.epochId !== candidate.epochId || candidate.revision > current.revision;
}
