import { access } from "node:fs/promises";
import { join } from "node:path";
import type {
  PiWebServerPlugin,
  ProjectInput,
  ProviderClaim,
  ProviderWorkspace,
  ServerPluginPeerRequestContext,
  WorkspaceProvider,
} from "@chainingintention/pi-web-cn/server-plugin-api";

const markerPath = ".pi-web/example-workspace-provider";

const plugin: PiWebServerPlugin = {
  apiVersion: 3,
  name: "工作区提供器示例",
  activate({ pluginId, logger }) {
    logger.info("激活工作区提供器示例", { pluginId });
    return {
      workspaceProvider: createWorkspaceProvider(),
      peer: { request: (context) => requestSummary(pluginId, context) },
    };
  },
};

export default plugin;

function createWorkspaceProvider(): WorkspaceProvider {
  return {
    async probe(project: ProjectInput, signal: AbortSignal): Promise<ProviderClaim> {
      signal.throwIfAborted();
      try {
        await access(join(project.path, markerPath));
        signal.throwIfAborted();
        return "claim";
      } catch (error) {
        if (isMissingFile(error)) return "pass";
        throw error;
      }
    },
    async list(project: ProjectInput, signal: AbortSignal): Promise<ProviderWorkspace[]> {
      signal.throwIfAborted();
      return [{
        key: "main",
        path: project.path,
        label: project.name,
        isMain: true,
        // This object is visible to every browser script and API consumer.
        publicMetadata: { kind: "example", marker: markerPath },
      }];
    },
  };
}

function requestSummary(pluginId: string, context: ServerPluginPeerRequestContext): string {
  context.signal.throwIfAborted();
  if (context.operation !== "summary") {
    throw new Error(`不支持的示例工作区操作：${context.operation}`);
  }
  return `${pluginId} 提供工作区 ${context.workspace.label}，路径：${context.workspace.path}`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && Reflect.get(error, "code") === "ENOENT";
}
