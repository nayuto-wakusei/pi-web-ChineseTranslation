import type { AppState } from "../appState";
import { LOCAL_MACHINE_ID } from "../machineKeys";

export function selectedMachineId(state: Pick<AppState, "selectedMachine">): string {
  return state.selectedMachine?.id ?? LOCAL_MACHINE_ID;
}

export type GetState = () => AppState;
export type SetState = (patch: Partial<AppState>) => void;
export type UpdateUrl = (options?: { replace?: boolean | undefined }) => void;

/** Navigation identity captured before an async operation begins, including the visible route. */
export interface NavigationSelection {
  machineId: string;
  projectId?: string | undefined;
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  tool?: string | undefined;
  view?: string | undefined;
}

export type NavigationScope = "machine" | "project" | "workspace" | "session" | "tool" | "view";

/** URL-field ownership is decided by the route coordinator, not by its consumers. */
export interface NavigationFreshness {
  readonly generation: number;
  readonly scope: readonly NavigationScope[];
  readonly isCurrent: () => boolean;
}

export interface NavigationDestinationOptions {
  /** Replace only the expected creation token, retaining the current URL surface. */
  creationHandoff?: boolean | undefined;
  replace?: boolean | undefined;
  expected?: NavigationSelection | undefined;
}

export interface RouteTarget {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  updateUrl?: boolean | undefined;
  navigation?: NavigationFreshness | undefined;
}
