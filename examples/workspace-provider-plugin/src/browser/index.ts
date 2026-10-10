import type { JsonObject, PiWebPlugin, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";

const summaries = new Map<string, string>();

const plugin = {
  apiVersion: 4,
  name: "工作区提供器示例",
  activate: ({ pluginId, runtimePluginId, html }) => ({
    contributions: {
      actions: [
        {
          id: "workspace.open",
          title: "打开工作区提供器示例",
          enabled: ({ state }) => state.selectedWorkspace?.provider?.pluginId === pluginId,
          run: ({ selectWorkspaceTool }) => {
            selectWorkspaceTool(`${runtimePluginId}:workspace.example-provider`);
          },
        },
      ],
      workspacePanels: [
        {
          id: "workspace.example-provider",
          title: "提供器示例",
          visible: ({ workspace }) => workspace.provider?.pluginId === pluginId,
          render: (context) => {
            const marker = stringMetadata(context.workspace.provider?.metadata, "marker") ?? "未知";
            const summary = summaries.get(workspaceKey(context)) ?? "请从此包的服务端插件获取摘要。";
            return html`
              <section class="toolbar"><strong>工作区提供器示例</strong></section>
              <section class="viewer">
                <p>此工作区由 <code>${pluginId}</code> 提供。</p>
                <p class="muted">接管标记：<code>${marker}</code></p>
                <button
                  ?disabled=${context.peer?.request === undefined}
                  @click=${() => { void refreshSummary(context); }}
                >获取包摘要</button>
                <p aria-live="polite">${summary}</p>
              </section>
            `;
          },
        },
      ],
    },
  }),
} satisfies PiWebPlugin;

export default plugin;

async function refreshSummary(context: WorkspacePanelContext): Promise<void> {
  const key = workspaceKey(context);
  try {
    if (context.peer?.request === undefined) throw new Error("插件后端不可用");
    const result = await context.peer.request("summary", null);
    if (typeof result !== "string") throw new Error("插件后端返回的摘要无效");
    summaries.set(key, result);
  } catch (error) {
    summaries.set(key, error instanceof Error ? error.message : String(error));
  }
  context.host.requestRender();
}

function workspaceKey(context: WorkspacePanelContext): string {
  return `${context.machine.id}:${context.workspace.id}`;
}

function stringMetadata(metadata: JsonObject | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}
