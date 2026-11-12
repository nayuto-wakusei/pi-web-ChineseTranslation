import type {
  ApplicationPanelContext,
  ApplicationPanelContribution,
  ContributionQueryValue,
  DisplayedMessageActionContext,
  MessageActionContext,
  PluginNavigate,
  PluginContributions,
  PluginContributionsV5,
  PluginNavigationDestination,
  PluginNavigationPatchDestination,
  PluginNavigationOptions,
  PluginRuntimeContext,
  PluginRuntimeContextV5,
  PluginSessionSnapshot,
  QualifiedContributionId,
  SessionLabelContext,
  ContentRenderingCapability,
  MarkdownExtensionContribution,
  MarkdownRenderingCapability,
  ContentRendererInput,
  TranscriptRendererContribution,
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
  StylesheetContribution,
  StylesheetIntegrationCapabilityV1,
  ThemeContribution,
  ThemeContributionV5,
  MaintenanceTerminal,
  TerminalCommandRun,
} from "@chainingintention/pi-web-cn/plugin-api";

export const transcriptToolRenderer: TranscriptRendererContribution = {
  id: "tool", target: "tool",
  resolve(toolName, next) {
    const name: string = toolName;
    if (name !== "read") return next();
    const downstream = next();
    return {
      render(input) {
        const status: "pending" | "running" | "success" | "error" = input.entry.status;
        const sessionId: string = input.scope.sessionId;
        void [status, sessionId, input.entry.args, input.entry.details, input.signal, input.fail];
        // @ts-expect-error Tool targets infer tool input, not custom-message input.
        input.entry.customType;
        // @ts-expect-error Transcript rendering conveys no provenance.
        input.source;
        return downstream?.render(input);
      },
    };
  },
};

export const transcriptMessageRenderer: TranscriptRendererContribution = {
  id: "message", target: "custom-message", customType: "notice",
  render(input) {
    const customType: string = input.entry.customType;
    void [customType, input.entry.content];
    // @ts-expect-error Custom-message targets infer message input, not tool input.
    input.entry.toolName;
    return undefined;
  },
};

export function checkTranscriptContributions(v4: PluginContributions, v5: PluginContributionsV5): void {
  v5.transcriptRenderers = [transcriptToolRenderer, transcriptMessageRenderer];
  // @ts-expect-error Transcript contributions are v5-only.
  v4.transcriptRenderers = [];
}

export function checkMarkdownExtensions(v4: PluginContributions, v5: PluginContributionsV5, capability: MarkdownRenderingCapability): void {
  const extension: MarkdownExtensionContribution = {
    id: "highlight", level: "inline",
    start: (source) => source.includes("==") ? source.indexOf("==") : undefined,
    tokenize: (source) => source.startsWith("==x==") ? { raw: "==x==", text: "x" } : undefined,
    render: (token) => `<mark>${token.text}</mark>`,
  };
  v5.markdownExtensions = [extension];
  // @ts-expect-error Syntax contributions are v5-only.
  v4.markdownExtensions = [extension];
  capability.render({ machineId: "local", text: "==x==", allowManualPreview: true });
  // @ts-expect-error Document HTML policy belongs to the host, not the caller.
  capability.render({ machineId: "local", text: "x", toSafeHtml: (text: string) => text });
  // @ts-expect-error Synchronous rendering cannot return a Promise.
  extension.render = async () => "<mark>x</mark>";
}

export function previewSessionAgePolicy(sessions: readonly PluginSessionSnapshot[], cutoff: number) {
  return sessions.filter((session) => {
    if (session.pinned !== false || session.runtime === "busy") return false;
    const timestamp = session.archived ? session.archivedAt : session.modified;
    return timestamp !== null && Date.parse(timestamp) < cutoff;
  });
}

export async function manageSavedSession(context: PluginRuntimeContextV5): Promise<void> {
  const sessions = context.sessions;
  if (sessions === undefined) return; // Hosts predating this optional service.
  const selected = { projectId: "fixture-project", workspaceId: "fixture-workspace", sessionId: "fixture-session" };
  await sessions.get(selected);
  await sessions.pin(selected);
  await sessions.unpin(selected);
  await sessions.archive(selected);
  await sessions.restore(selected);
  await sessions.delete(selected);
  // @ts-expect-error Session paths are resolved by the host, not supplied as authority.
  await sessions.archive({ cwd: "/repo", sessionId: selected.sessionId });
}

// Existing plugins can extend workspace run records and read their identity
// without a maintenance-scope check.
export interface WorkspaceRunExtension extends TerminalCommandRun {
  pluginTag?: string;
}

export async function readWorkspaceCommandIdentity(context: WorkspacePanelContext): Promise<{ projectId: string; workspaceId: string }> {
  const { run } = await context.terminal.runCommand({ title: "Build", command: "npm run build" });
  return { projectId: run.projectId, workspaceId: run.workspaceId };
}

export async function readMaintenanceCommandScope(terminal: MaintenanceTerminal): Promise<"maintenance"> {
  const { run } = await terminal.runCommand({ title: "Update", command: "pi-web update" });
  // @ts-expect-error Machine maintenance output cannot be used as a workspace run.
  const workspaceRun: TerminalCommandRun = run;
  void workspaceRun;
  return run.scope;
}

export function checkStylesheets(integration: StylesheetIntegrationCapabilityV1, root: ShadowRoot): void {
  const release = integration.registerRoot(root, { sharedUi: true });
  const unsubscribe = integration.subscribe(() => undefined);
  unsubscribe();
  release();
}

export const cssTheme: ThemeContributionV5 = {
  id: "night", name: "Night", colorScheme: "dark",
  stylesheets: [{ id: "palette", url: "https://plugins.test/night.css" } satisfies StylesheetContribution],
};
export const legacyTheme: ThemeContribution = { id: "legacy", name: "Legacy", colorScheme: "dark", tokens: { "--pi-bg": "#111" } };
// @ts-expect-error v4 themes retain the required palette contract.
export const missingLegacyPalette: ThemeContribution = { id: "bad", name: "Bad", colorScheme: "dark" };
// @ts-expect-error v5 themes are CSS-first, not legacy palette objects.
export const paletteOnV5Theme: ThemeContributionV5 = { ...cssTheme, tokens: { "--pi-bg": "#111" } };

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
        messageActions: [{
          id: "reopen-question",
          title: "Reopen question",
          visible: ({ message }) => message.isQuestion === true,
          run: async (context) => { await context.history.goBack(); },
        }],
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
