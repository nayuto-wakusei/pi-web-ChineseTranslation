import { t } from "../i18n";
import { requireTerminalCommandRun as parseTerminalCommandRun } from "../../../shared/terminalCommandRun";
import type { TerminalCommandRun, TerminalCommandRunStatus, Workspace } from "../api";
import type { ContributionQueryValue, PluginCapability, PluginPeer, QualifiedContributionId, WorkspacePanelTerminal, WorkspacePluginBinding, WorkspaceTerminalCommandInput } from "./types";

export interface WorkspaceContributionNavigationV1 {
  readonly contributionId: QualifiedContributionId;
  readonly navigationAliases?: readonly QualifiedContributionId[];
  readonly query: Readonly<Record<string, ContributionQueryValue | undefined | null>>;
}

export interface RequiredTerminalFacadeHostV1 {
  navigateWorkspaceContribution(workspace: Workspace, navigation: WorkspaceContributionNavigationV1): void | Promise<void>;
}

export interface RequiredTerminalWorkspaceBindingV1 {
  readonly origin: string;
  readonly registrationPluginId: string;
  readonly workspace: Workspace;
  readonly peer: PluginPeer;
  readonly host: RequiredTerminalFacadeHostV1;
}

export interface RequiredTerminalCommandRunQueryV1 {
  readonly peer: PluginPeer;
  readonly filter?: Readonly<{
    terminalId?: string;
    statuses?: readonly TerminalCommandRunStatus[];
    metadata?: Readonly<Record<string, string>>;
  }>;
  readonly signal?: AbortSignal;
}

/** Privileged host-only composition port supplied by the required bundled Terminal; not third-party API. */
export interface RequiredTerminalBrowserFacadeV1 {
  readonly version: 1;
  createWorkspaceTerminal(binding: RequiredTerminalWorkspaceBindingV1): WorkspacePanelTerminal;
  listCommandRuns(query: RequiredTerminalCommandRunQueryV1): Promise<TerminalCommandRun[]>;
  parseCommandRun(value: unknown): TerminalCommandRun;
}

export interface RequiredTerminalBrowserComposition {
  readonly binding: WorkspacePluginBinding;
  readonly facade: RequiredTerminalBrowserFacadeV1;
}

/** Host-owned structural token matching Terminal's package-owned capability. */
export const REQUIRED_TERMINAL_BROWSER_FACADE_CAPABILITY = Object.freeze({
  pluginId: "pi-web.terminal",
  id: "browser-facade",
  version: 1,
  parse: snapshotRequiredTerminalBrowserFacade,
}) satisfies PluginCapability<RequiredTerminalBrowserFacadeV1, 1>;

export class RequiredTerminalBrowserUnavailableError extends Error {
  override name = "RequiredTerminalBrowserUnavailableError";
}

export function snapshotRequiredTerminalBrowserFacade(value: unknown): RequiredTerminalBrowserFacadeV1 {
  if (!isRecord(value) || value["version"] !== 1) {
    throw new Error("Required Terminal browser entry did not provide facade v1");
  }
  const createWorkspaceTerminal = value["createWorkspaceTerminal"];
  const listCommandRuns = value["listCommandRuns"];
  const parseCommandRun = value["parseCommandRun"];
  if (typeof createWorkspaceTerminal !== "function" || typeof listCommandRuns !== "function" || typeof parseCommandRun !== "function") {
    throw new Error("Required Terminal browser entry did not provide facade v1");
  }
  const facade: RequiredTerminalBrowserFacadeV1 = {
    version: 1,
    createWorkspaceTerminal(binding) {
      const terminal: unknown = Reflect.apply(createWorkspaceTerminal, value, [binding]);
      if (!isRecord(terminal)) throw new Error("Required Terminal browser facade returned an invalid workspace terminal");
      const open = terminal["open"];
      const runCommand = terminal["runCommand"];
      if (typeof open !== "function" || typeof runCommand !== "function") {
        throw new Error("Required Terminal browser facade returned an invalid workspace terminal");
      }
      return Object.freeze({
        open: (options?: { terminalId?: string | undefined }) => { Reflect.apply(open, terminal, [options]); },
        runCommand: (input: WorkspaceTerminalCommandInput) => Promise.resolve(Reflect.apply(runCommand, terminal, [input])).then(requireTerminalCommandRunHandle),
      });
    },
    async listCommandRuns(query) {
      const result: unknown = await Reflect.apply(listCommandRuns, value, [query]);
      if (!Array.isArray(result)) throw new Error("Required Terminal browser facade returned an invalid command-run list");
      return result.map((run) => facade.parseCommandRun(run));
    },
    parseCommandRun(input) {
      return requireTerminalCommandRun(Reflect.apply(parseCommandRun, value, [input]));
    },
  };
  return Object.freeze(facade);
}

export function requiredTerminalUnavailableError(machineId: string): RequiredTerminalBrowserUnavailableError {
  return new RequiredTerminalBrowserUnavailableError(
    machineId === "local"
      ? t("ui.main.9ff7a30a5924", "Required Terminal plugin is unavailable. Open Settings for recovery guidance.")
      : t("ui.main.cddadc4e8321", "The required terminal plugin is unavailable on machine {arg0}. Open settings for recovery guidance.", { arg0: machineId }),
  );
}

function requireTerminalCommandRunHandle(value: unknown) {
  if (!isRecord(value) || !(value["completed"] instanceof Promise)) {
    throw new Error("Required Terminal browser facade returned an invalid command-run handle");
  }
  return Object.freeze({
    run: requireTerminalCommandRun(value["run"]),
    completed: value["completed"].then(requireTerminalCommandRun),
  });
}

function requireTerminalCommandRun(value: unknown): TerminalCommandRun {
  return parseTerminalCommandRun(value, invalidCommandRun);
}

function invalidCommandRun(): Error {
  return new Error("Required Terminal browser facade returned an invalid command run");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
