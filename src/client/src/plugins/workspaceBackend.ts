import type { JsonValue, Workspace } from "../api";
import { openPluginBackendChannel, requestPluginBackend, type PluginBackendRequestOptions, type PluginBackendRequestTarget } from "../api/pluginBackends";
import type { PluginPeer, WorkspaceBackend, WorkspacePluginBinding } from "./types";

export type PluginBackendRequester = (
  target: PluginBackendRequestTarget,
  operation: string,
  input: JsonValue,
  options?: PluginBackendRequestOptions,
) => Promise<JsonValue>;

export function createPluginPeer(
  binding: WorkspacePluginBinding,
  workspace: Pick<Workspace, "id" | "projectId">,
  machineId: string,
  request: PluginBackendRequester = requestPluginBackend,
): PluginPeer | undefined {
  if (binding.pairedRequestVersion !== 1 && binding.pairedChannelVersion !== 1) return undefined;
  const backendRevision = binding.backendRevision;
  if (backendRevision === undefined) return undefined;
  const target = {
    pluginId: binding.sourcePluginId,
    backendRevision,
    machineId,
    projectId: workspace.projectId,
    workspaceId: workspace.id,
  };
  const openChannel = (operation: string, input: JsonValue, options: Parameters<typeof openPluginBackendChannel>[3]) => openPluginBackendChannel(target, operation, input, options);
  if (binding.pairedRequestVersion === 1) {
    return {
      request: (operation, input, options) => request(target, operation, input, options),
      ...(binding.pairedChannelVersion === 1 ? { openChannel } : {}),
    };
  }
  return { openChannel };
}

export function createPluginWorkspaceBackend(
  binding: WorkspacePluginBinding,
  workspace: Pick<Workspace, "id" | "projectId">,
  machineId: string,
  request: PluginBackendRequester = requestPluginBackend,
): WorkspaceBackend | undefined {
  const backendRevision = binding.backendRevision;
  if (backendRevision === undefined) return undefined;
  return {
    request: (operation, input) => request({
      pluginId: binding.sourcePluginId,
      backendRevision,
      machineId,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    }, operation, input),
  };
}
