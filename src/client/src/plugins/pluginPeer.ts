import type { JsonValue, Workspace } from "../api";
import type { PluginBackend, PluginBackendScope } from "../../../plugin-api";
import {
  openPairedPluginBackendChannel,
  pairedPluginBackendResourceUrl,
  requestPairedPluginBackend,
  type PluginBackendChannel,
  type PluginBackendChannelOptions,
  type PluginBackendRequestOptions,
  type PluginBackendRequestTarget,
} from "../api/pluginBackends";
import type {
  PluginPeer,
  PluginPeerRequestOptions,
  WorkspacePluginBinding,
} from "./types";

export type PluginPeerRequester = (
  target: PluginBackendRequestTarget,
  operation: string,
  input: JsonValue,
  options?: PluginBackendRequestOptions,
) => Promise<JsonValue>;

export type PluginPeerChannelOpener = (
  target: PluginBackendRequestTarget,
  operation: string,
  input: JsonValue,
  options: PluginBackendChannelOptions,
) => Promise<PluginBackendChannel>;

export type PluginPeerResourceUrlBuilder = (
  target: PluginBackendRequestTarget,
  operation: string,
  input: JsonValue,
) => string;

/** Expose only the capabilities contributed by this exact revision-paired package. */
export function createPluginPeer(
  binding: WorkspacePluginBinding,
  workspace: Pick<Workspace, "id" | "projectId">,
  machineId: string,
  request: PluginPeerRequester = requestPairedPluginBackend,
  openChannel: PluginPeerChannelOpener = openPairedPluginBackendChannel,
  resourceUrl: PluginPeerResourceUrlBuilder = pairedPluginBackendResourceUrl,
): PluginPeer | undefined {
  if (binding.pairedRequestVersion !== 1 && binding.pairedChannelVersion !== 1 && binding.pairedResourceVersion !== 1) return undefined;
  const target = pluginBackendTarget(binding, workspace, machineId);
  if (target === undefined) return undefined;
  const resource = (operation: string, input: JsonValue) => resourceUrl(target, operation, input);
  const resources = binding.pairedResourceVersion === 1 ? { resourceUrl: resource } : {};
  const opener: NonNullable<PluginPeer["openChannel"]> = (operation, input, options) => openChannel(target, operation, input, options);
  if (binding.pairedRequestVersion === 1) {
    return {
      request: (operation: string, input: JsonValue, options?: PluginPeerRequestOptions) => request(target, operation, input, options),
      ...(binding.pairedChannelVersion === 1 ? { openChannel: opener } : {}),
      ...resources,
    };
  }
  if (binding.pairedChannelVersion === 1) return { openChannel: opener, ...resources };
  return { resourceUrl: resource };
}

/** Fixed machine and package revision; callback selection cannot retarget retained peers. */
export function createPluginBackend(
  binding: WorkspacePluginBinding,
  machineId: string,
  lifetimeSignal?: AbortSignal,
  request: PluginPeerRequester = requestPairedPluginBackend,
  openChannel: PluginPeerChannelOpener = openPairedPluginBackendChannel,
  resourceUrl: PluginPeerResourceUrlBuilder = pairedPluginBackendResourceUrl,
): PluginBackend | undefined {
  if (binding.backendRevision === undefined || (binding.pairedRequestVersion !== 1 && binding.pairedChannelVersion !== 1 && binding.pairedResourceVersion !== 1)) return undefined;
  const backendRevision = binding.backendRevision;
  const { sourcePluginId, pairedRequestVersion, pairedChannelVersion, pairedResourceVersion } = binding;
  const signalFor = (signal?: AbortSignal) => lifetimeSignal === undefined ? signal
    : signal === undefined ? lifetimeSignal : AbortSignal.any([lifetimeSignal, signal]);
  return Object.freeze({
    machineId,
    forScope(scope: PluginBackendScope): PluginPeer {
      lifetimeSignal?.throwIfAborted();
      if (scope.kind !== "machine" && (typeof scope.projectId !== "string" || scope.projectId === "")) throw new Error("Project id is required");
      if (scope.kind === "workspace" && (typeof scope.workspaceId !== "string" || scope.workspaceId === "")) throw new Error("Workspace id is required");
      const target: PluginBackendRequestTarget = Object.freeze({
        pluginId: sourcePluginId,
        backendRevision,
        machineId,
        scope: scope.kind,
        ...(scope.kind === "machine" ? {} : { projectId: scope.projectId }),
        ...(scope.kind === "workspace" ? { workspaceId: scope.workspaceId } : {}),
      });
      const requester = (operation: string, input: JsonValue, options?: PluginPeerRequestOptions) => {
        const signal = signalFor(options?.signal);
        signal?.throwIfAborted();
        return request(target, operation, input, { ...(signal === undefined ? {} : { signal }) });
      };
      const opener: NonNullable<PluginPeer["openChannel"]> = (operation, input, options) => {
        const signal = signalFor(options.signal);
        signal?.throwIfAborted();
        return openChannel(target, operation, input, { ...options, ...(signal === undefined ? {} : { signal }) });
      };
      const resource = (operation: string, input: JsonValue) => {
        lifetimeSignal?.throwIfAborted();
        return resourceUrl(target, operation, input);
      };
      const resources = pairedResourceVersion === 1 ? { resourceUrl: resource } : {};
      if (pairedRequestVersion === 1) return Object.freeze({ request: requester, ...(pairedChannelVersion === 1 ? { openChannel: opener } : {}), ...resources });
      if (pairedChannelVersion === 1) return Object.freeze({ openChannel: opener, ...resources });
      return Object.freeze({ resourceUrl: resource });
    },
  });
}

function pluginBackendTarget(
  binding: WorkspacePluginBinding,
  workspace: Pick<Workspace, "id" | "projectId">,
  machineId: string,
): PluginBackendRequestTarget | undefined {
  const backendRevision = binding.backendRevision;
  if (backendRevision === undefined) return undefined;
  return {
    pluginId: binding.sourcePluginId,
    backendRevision,
    machineId,
    projectId: workspace.projectId,
    workspaceId: workspace.id,
  };
}
