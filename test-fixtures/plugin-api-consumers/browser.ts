import type {
  ContentRenderingCapability,
  ContentRendererInput,
  JsonValue,
  LocalizationContribution,
  TranslationParameters,
  Translator,
  PluginCapability,
  PluginPeer,
  PiWebPlugin,
  Workspace,
  WorkspaceFiles,
  WorkspaceFilesCapabilityV1,
  WorkspaceFilesContextValue,
  WorkspacePanelContext,
  WorkspacePanelFiles,
} from "@chainingintention/pi-web-cn/plugin-api";

export function checkLocalization(translate?: Translator): LocalizationContribution {
  const parameters: TranslationParameters = { name: "fixture", count: 1 };
  return { locale: "en", messages: { greeting: translate?.("fixture.greeting", "Hello {name}: {count}", parameters) ?? "Hello fixture: 1" } };
}

export function checkContentRendering(capability: ContentRenderingCapability, input: ContentRendererInput): void {
  const request = { machineId: "local", text: input.text };
  capability.listRenderers({ ...request, language: "diagram", filePath: "graph.diag" });
  capability.renderText({ ...request, allowManualPreview: true });
  capability.renderText({ ...request, controls: "external", rendererId: "plugin:diagram", allowManualPreview: false });
  // @ts-expect-error Embedded controls own selection.
  capability.renderText({ ...request, rendererId: "plugin:diagram" });
  const markdown = { ...request, toSafeHtml: (text: string) => text, allowManualPreview: true };
  capability.renderMarkdown(markdown);
  // @ts-expect-error Intent memory is private Chat policy.
  capability.renderMarkdown({ ...markdown, intentKey: "session" });
  // @ts-expect-error Markdown discovers language from fences.
  capability.renderMarkdown({ ...markdown, language: "diagram" });
  // @ts-expect-error Markdown has no file selector.
  capability.renderMarkdown({ ...markdown, filePath: "graph.md" });
  // @ts-expect-error Renderer input does not claim provenance.
  input.source;
}

interface FixtureIdentityCapabilityV1 {
  readonly version: 1;
  readonly label: string;
}

const identityCapability: PluginCapability<FixtureIdentityCapabilityV1, 1> = Object.freeze({
  pluginId: "fixture-provider",
  id: "identity",
  version: 1,
  parse(value: unknown): FixtureIdentityCapabilityV1 {
    if (typeof value !== "object" || value === null || Reflect.get(value, "version") !== 1 || typeof Reflect.get(value, "label") !== "string") {
      throw new Error("Invalid fixture identity capability");
    }
    return Object.freeze({ version: 1, label: Reflect.get(value, "label") });
  },
});

const publishedCapability: PluginCapability<FixtureIdentityCapabilityV1, 1> = Object.freeze({
  pluginId: "browser-declaration-fixture",
  id: "identity",
  version: 1,
  parse: identityCapability.parse,
});

const plugin: PiWebPlugin = {
  apiVersion: 4,
  name: "Browser declaration fixture",
  requires: [identityCapability],
  activate: async (context) => ({
    provides: [{ capability: publishedCapability, value: { version: 1, label: context.pluginId } }],
    start: ({ capabilities, signal }) => {
      if (signal.aborted || context.lifetimeSignal.aborted) return;
      capabilities.resolve(identityCapability);
      context.selection?.getSnapshot();
      context.selection?.subscribe((selection) => { void selection.selectedProject?.path; });
    },
    dispose: (signal) => {
      if (signal.aborted) return;
    },
    contributions: {
      applicationPanels: [{
        id: "application",
        title: "Application fixture",
        render: (panel) => context.html`<button @click=${async () => {
          await panel.projects?.listProjects();
          await panel.projects?.suggestDirectories("/repo");
          panel.prompt.setChip?.({ id: "context", label: "Context", text: "Fixture", onRemove: (reason) => { void reason; } });
          panel.prompt.removeChip?.("context");
        }}>${panel.machine.id}</button>`,
      }],
      actions: [{
        id: "identity",
        title: context.pluginId,
        enabled: ({ state }) => {
          const session = state.selectedSession;
          return session !== undefined && session.id !== "" && session.cwd !== ""
            && (session.name === undefined || typeof session.name === "string") && !session.archived && !session.pending;
        },
        run: ({ selectWorkspaceTool }) => {
          selectWorkspaceTool(`${context.runtimePluginId}:workspace.fixture`);
        },
      }],
    },
  }),
};

// Keep common browser-v2 adapter and fake patterns compiling against the
// installed declaration, not only against this repository's source graph.
interface ExtendedWorkspaceFiles extends WorkspaceFiles { readonly adapterName?: string; }
interface ExtendedWorkspacePanelFiles extends WorkspacePanelFiles { readonly panelName?: string; }
declare class ImplementedWorkspaceFiles implements WorkspaceFiles {
  readFile: WorkspaceFiles["readFile"];
  listFiles: WorkspaceFiles["listFiles"];
  writeFile: WorkspaceFiles["writeFile"];
  deleteFile: WorkspaceFiles["deleteFile"];
  moveFile: WorkspaceFiles["moveFile"];
}
declare class ImplementedWorkspacePanelFiles implements WorkspacePanelFiles {
  readFile: WorkspacePanelFiles["readFile"];
  listFiles: WorkspacePanelFiles["listFiles"];
  writeFile: WorkspacePanelFiles["writeFile"];
  deleteFile: WorkspacePanelFiles["deleteFile"];
  moveFile: WorkspacePanelFiles["moveFile"];
}

function capabilityV1(files: WorkspaceFilesContextValue): WorkspaceFilesCapabilityV1 | undefined {
  return files.capabilityVersion === 1 ? files : undefined;
}

async function requestPeer(context: WorkspacePanelContext): Promise<JsonValue | undefined> {
  const peer: PluginPeer | undefined = context.peer;
  if (peer?.request === undefined) return undefined;
  return await peer.request("fixture.summary", null);
}

function openPeerChannel(context: WorkspacePanelContext): void {
  const peer = context.peer;
  if (peer?.openChannel === undefined) return;
  void peer.openChannel("fixture.watch", null, { onData: echoJson });
}

const echoJson = (value: JsonValue): JsonValue => value;
export { capabilityV1, echoJson, identityCapability, openPeerChannel, plugin, publishedCapability, requestPeer };
export type {
  BrowserWorkspace,
  ExtendedWorkspaceFiles,
  ExtendedWorkspacePanelFiles,
  ImplementedWorkspaceFiles,
  ImplementedWorkspacePanelFiles,
};
type BrowserWorkspace = Workspace;

/** The current entry keeps contextual callback typing without manual annotations. */
export const pluginV5: PiWebPlugin = {
  apiVersion: 5,
  name: "V5 consumer",
  activate({ apiVersion, html }) {
    const version: 5 = apiVersion;
    return {
      contributions: {
        actions: [{
          id: "discover",
          title: "Discover",
          async run(context) {
            const projects = await context.catalog.projects.list();
            const project = projects[0];
            if (project === undefined) return;
            const workspaces = await context.catalog.workspaces.list(project.id);
            const workspace = workspaces[0];
            if (workspace === undefined) return;
            await context.catalog.sessions.list({ projectId: project.id, workspaceId: workspace.id });
            await context.backend?.forScope({ kind: "machine" }).request?.("fixture.summary", null);
          },
        }],
        applicationPanels: [{ id: "catalog", title: "Catalog", render: (context) => html`${version}: ${context.catalog.machineId}` }],
      },
    };
  },
};
