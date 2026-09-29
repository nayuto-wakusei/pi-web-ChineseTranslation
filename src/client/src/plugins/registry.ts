import { html, svg } from "lit";
import { requirePluginBackendRevision } from "../../../shared/pluginBackendProtocol";
import type { PluginCapability, PluginCapabilityProvision } from "../../../shared/pluginApiTypes";
import type { ContentRenderRequest } from "../../../plugin-api";
import { contentRenderingCapabilityToken, createContentRenderingService } from "../formatting/contentRendering";
import { compareContentRenderers, contentRendererMatches, snapshotContentRenderer, type ContentRendererChoice, type RegisteredContentRenderer } from "./contentRenderers";
import type { PiWebPluginRegistration, PluginAction, PluginActivationResult, PluginRuntimeContext, QualifiedContributionId, QualifiedPluginAction, QualifiedThemeContribution, QualifiedThemePairContribution, QualifiedWorkspaceLabelContribution, QualifiedWorkspacePanelContribution, ThemeContribution, ThemePairContribution, WorkspaceLabelContext, WorkspaceLabelContribution, WorkspaceLabelItem, WorkspacePanelContext, WorkspacePanelContribution, WorkspacePluginBinding } from "./types";

const idPattern = /^[a-z][a-z0-9.-]*$/u;
const localIdPattern = /^[a-z][a-z0-9.-]*$/u;
const qualifiedContributionIdPattern = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/u;
const routeAliasPattern = /^[a-z][a-z0-9.-]*(?::[a-z][a-z0-9.-]*)?$/u;
const pluginRuntimeScopes = new WeakMap<PluginRuntimeContext, (pluginId: string) => PluginRuntimeContext>();
const workspacePanelScopes = new WeakMap<WorkspacePanelContext, (binding: WorkspacePluginBinding) => WorkspacePanelContext>();
const workspaceLabelScopes = new WeakMap<WorkspaceLabelContext, (binding: WorkspacePluginBinding) => WorkspaceLabelContext>();

type RegisteredPluginAction = Omit<PluginAction, "id"> & {
  id: QualifiedContributionId;
  pluginId: string;
  localId: string;
  machineId?: string;
  sourcePluginId?: string;
};

export class PluginRegistry {
  private readonly contentRenderers: RegisteredContentRenderer[] = [];
  readonly chatContentRendering = createContentRenderingService((request) => this.matchContentRenderers(request));
  private contentRendererRevision = 0;
  readonly contentRendering = this.chatContentRendering.capability;
  private readonly actions: RegisteredPluginAction[] = [];
  private readonly workspacePanels: QualifiedWorkspacePanelContribution[] = [];
  private readonly workspaceLabels: QualifiedWorkspaceLabelContribution[] = [];
  private readonly themes: QualifiedThemeContribution[] = [];
  private readonly themePairs: QualifiedThemePairContribution[] = [];
  private readonly pluginIds = new Set<string>();
  private readonly registeringPluginIds = new Set<string>();
  private readonly gatewayPluginIds = new Set<string>();
  private readonly gatewayMachineSpecificPluginIds = new Set<string>();
  private readonly remoteMachineSpecificPluginIds = new Map<string, Set<string>>();
  private readonly contributionIds = new Set<QualifiedContributionId>();
  private readonly capabilities = new Map<string, PluginCapabilityProvision>();
  private readonly activePlugins: { id: string; activation: PluginActivationResult; lifetime: AbortController }[] = [];
  private shuttingDown = false;

  constructor() {
    const key = capabilityKey(contentRenderingCapabilityToken);
    this.capabilities.set(key, { capability: contentRenderingCapabilityToken, value: this.contentRendering });
  }

  get contentRendererVersion(): number {
    return this.contentRendererRevision;
  }

  matchContentRenderers(request: ContentRenderRequest): readonly ContentRendererChoice[] {
    return this.contentRenderers.filter((renderer) => this.isContributionActive(renderer.pluginId, renderer.machineId, request.machineId, renderer.sourcePluginId) && contentRendererMatches(renderer, request))
      .sort(compareContentRenderers)
      .map((renderer) => ({ id: renderer.id, label: renderer.label, renderer }));
  }

  resolveWorkspaceFileOpen(context: WorkspacePanelContext, path: string): { contributionId: QualifiedContributionId; query: Readonly<Record<string, string>> } | undefined {
    for (const panel of this.getWorkspacePanels()) {
      if (panel.visible?.(context) === false) continue;
      const query = panel.fileOpenQuery?.(context, path);
      if (query !== undefined) return { contributionId: panel.id, query };
    }
    return undefined;
  }

  register(registration: PiWebPluginRegistration): Promise<void> {
    const { plugin } = registration;
    const runtimePluginId = registration.id;
    const sourcePluginId = registration.sourcePluginId ?? runtimePluginId;
    this.validatePluginId(runtimePluginId);
    this.validatePluginId(sourcePluginId);
    const machineSpecific = this.parseMachineSpecific(runtimePluginId, registration.machineSpecific);
    const backendRevision = this.parseBackendRevision(runtimePluginId, registration.backendRevision);
    this.parsePairedCapabilityVersions(runtimePluginId, registration, backendRevision);
    if (this.pluginIds.has(runtimePluginId) || this.registeringPluginIds.has(runtimePluginId)) throw new Error(`Duplicate plugin id: ${runtimePluginId}`);
    if (this.isRemoteDuplicateHiddenByGateway(registration.sourcePluginId, registration.machineId, machineSpecific)) return Promise.resolve();

    this.registeringPluginIds.add(runtimePluginId);
    try {
      const apiVersion: unknown = plugin.apiVersion;
      if (apiVersion !== 4) throw new Error(`Unsupported browser plugin API version for ${sourcePluginId}: ${String(apiVersion)} (expected 4)`);
      if (this.shuttingDown) throw new Error("Browser plugin host is shutting down");
      const requirements = plugin.requires ?? [];
      for (const requirement of requirements) {
        if (!this.capabilities.has(capabilityKey(requirement))) throw new Error(`Unavailable browser plugin capability: ${capabilityKey(requirement)}`);
      }
      const lifetime = new AbortController();
      const activated = plugin.activate(Object.freeze({
        apiVersion: 4,
        pluginId: sourcePluginId,
        runtimePluginId,
        html,
        svg,
        signal: lifetime.signal,
        lifetimeSignal: lifetime.signal,
      }));
      if (activated instanceof Promise) {
        return activated.then((activation) => this.finishRegistration(registration, activation, lifetime, requirements))
          .finally(() => { this.registeringPluginIds.delete(runtimePluginId); });
      }
      const result = this.finishRegistration(registration, activated, lifetime, requirements);
      return result.finally(() => { this.registeringPluginIds.delete(runtimePluginId); });
    } catch (error) {
      this.registeringPluginIds.delete(runtimePluginId);
      throw error;
    }
  }

  private finishRegistration(
    registration: PiWebPluginRegistration,
    activation: PluginActivationResult,
    lifetime: AbortController,
    requirements: readonly PluginCapability[],
  ): Promise<void> {
    const runtimePluginId = registration.id;
    const sourcePluginId = registration.sourcePluginId ?? runtimePluginId;
    const machineSpecific = this.parseMachineSpecific(runtimePluginId, registration.machineSpecific);
    const backendRevision = this.parseBackendRevision(runtimePluginId, registration.backendRevision);
    const pairedRequestVersion = this.parsePairedCapabilityVersion(runtimePluginId, "request", registration.pairedRequestVersion, backendRevision);
    const pairedChannelVersion = this.parsePairedCapabilityVersion(runtimePluginId, "channel", registration.pairedChannelVersion, backendRevision);
    const contributions = activation.contributions;
    const publish = (): void => {
      if (this.shuttingDown || lifetime.signal.aborted) return;
      for (const provision of activation.provides ?? []) {
        const key = capabilityKey(provision.capability);
        if (provision.capability.pluginId !== sourcePluginId) throw new Error(`Plugin ${sourcePluginId} cannot provide ${key}`);
        if (this.capabilities.has(key)) throw new Error(`Duplicate browser plugin capability: ${key}`);
        provision.capability.parse(provision.value);
        this.capabilities.set(key, provision);
      }
      const contributionIds = new Set<QualifiedContributionId>();
      const contentRenderers = (contributions.contentRenderers ?? []).map((renderer): RegisteredContentRenderer => {
        const snapshot = snapshotContentRenderer(renderer);
        return {
          ...snapshot,
          id: this.qualify(runtimePluginId, renderer.id, contributionIds),
          pluginId: runtimePluginId,
          localId: renderer.id,
          label: `${sourcePluginId} / ${renderer.id}`,
          ...(registration.machineId === undefined ? {} : { machineId: registration.machineId }),
          ...(registration.sourcePluginId === undefined ? {} : { sourcePluginId: registration.sourcePluginId }),
          render: (input) => {
            const signal = linkAbortSignals(input.signal, lifetime.signal);
            return snapshot.render({ ...input, signal, fail: (error) => { if (!signal.aborted) input.fail(error); } });
          },
        };
      });
      const actions = (contributions.actions ?? []).map((action) => this.qualifyAction(runtimePluginId, action, registration.machineId, registration.sourcePluginId, contributionIds));
      const workspacePanels = (contributions.workspacePanels ?? []).map((panel) => this.qualifyWorkspacePanel(runtimePluginId, panel, registration.machineId, registration.sourcePluginId, backendRevision, pairedRequestVersion, pairedChannelVersion, contributionIds));
      const workspaceLabels = (contributions.workspaceLabels ?? []).map((contribution) => this.qualifyWorkspaceLabelContribution(runtimePluginId, contribution, registration.machineId, registration.sourcePluginId, backendRevision, pairedRequestVersion, pairedChannelVersion, contributionIds));
      const themes = registration.machineId === undefined
        ? (contributions.themes ?? []).map((theme) => this.qualifyTheme(runtimePluginId, theme, contributionIds))
        : [];
      const themePairs = registration.machineId === undefined
        ? (contributions.themePairs ?? []).map((pair) => this.qualifyThemePair(runtimePluginId, pair, contributionIds))
        : [];

      this.pluginIds.add(runtimePluginId);
      for (const contributionId of contributionIds) this.contributionIds.add(contributionId);
      this.contentRenderers.push(...contentRenderers);
      if (contentRenderers.length > 0) this.contentRendererRevision += 1;
      this.actions.push(...actions);
      this.workspacePanels.push(...workspacePanels);
      this.workspaceLabels.push(...workspaceLabels);
      this.themes.push(...themes);
      this.themePairs.push(...themePairs);
      this.activePlugins.push({ id: runtimePluginId, activation, lifetime });
      if (registration.machineId === undefined) {
        this.gatewayPluginIds.add(runtimePluginId);
        if (machineSpecific) this.gatewayMachineSpecificPluginIds.add(runtimePluginId);
      } else if (registration.sourcePluginId !== undefined && machineSpecific) {
        addMappedSetValue(this.remoteMachineSpecificPluginIds, registration.sourcePluginId, registration.machineId);
      }
    };
    const start = activation.start?.bind(activation);
    if (start === undefined) {
      publish();
      return Promise.resolve();
    }
    const resolved = new Map(requirements.map((requirement) => [capabilityKey(requirement), this.capabilities.get(capabilityKey(requirement))]));
    const started = start({
      capabilities: {
        resolve: <Value>(capability: PluginCapability<Value>): Value => {
          const key = capabilityKey(capability);
          if (!resolved.has(key)) throw new Error(`Undeclared browser plugin capability: ${key}`);
          const provision = resolved.get(key);
          if (provision === undefined) throw new Error(`Unavailable browser plugin capability: ${key}`);
          return capability.parse(provision.value);
        },
      },
      signal: lifetime.signal,
    });
    if (started instanceof Promise) return started.then(publish).catch((error: unknown) => { lifetime.abort(error); throw error; });
    publish();
    return Promise.resolve();
  }

  beginShutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const active of this.activePlugins) active.lifetime.abort();
  }

  async dispose(): Promise<void> {
    this.beginShutdown();
    for (const active of [...this.activePlugins].reverse()) {
      try { await active.activation.dispose?.(new AbortController().signal); }
      catch (error) { console.warn(`Failed to dispose PI WEB plugin ${active.id}`, error); }
    }
    this.activePlugins.length = 0;
  }

  hasPlugin(pluginId: string): boolean {
    return this.pluginIds.has(pluginId);
  }

  shouldLoadRemotePlugin(sourcePluginId: string, machineSpecific = false): boolean {
    return !this.gatewayPluginIds.has(sourcePluginId) || this.gatewayMachineSpecificPluginIds.has(sourcePluginId) || machineSpecific;
  }

  getActions(context: PluginRuntimeContext): QualifiedPluginAction[] {
    const selectedMachineId = runtimeContextMachineId(context);
    return this.actions.filter((action) => this.isContributionActive(action.pluginId, action.machineId, selectedMachineId, action.sourcePluginId)).map((action) => {
      const scopedContext = pluginRuntimeContextFor(context, action.pluginId);
      const enabled = action.enabled?.(scopedContext);
      const disabledReason = enabled === false ? action.disabledReason?.(scopedContext) : undefined;
      const qualified: QualifiedPluginAction = {
        id: action.id,
        pluginId: action.pluginId,
        localId: action.localId,
        ...(action.machineId === undefined ? {} : { machineId: action.machineId }),
        title: action.title,
        run: () => action.run(scopedContext),
      };
      if (action.description !== undefined) qualified.description = action.description;
      if (action.shortcut !== undefined) qualified.shortcut = action.shortcut;
      if (action.shortcutAliases !== undefined) qualified.shortcutAliases = [...action.shortcutAliases];
      if (action.group !== undefined) qualified.group = action.group;
      if (enabled !== undefined) qualified.enabled = enabled;
      if (disabledReason !== undefined && disabledReason !== "") qualified.disabledReason = disabledReason;
      return qualified;
    });
  }

  getWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
    return [...this.workspacePanels].sort((left, right) => (left.order ?? 1000) - (right.order ?? 1000) || left.title.localeCompare(right.title));
  }

  resolveWorkspacePanelRouteId(value: string, selectedMachineId: string): QualifiedContributionId | undefined {
    const activePanels = this.activeWorkspacePanels(selectedMachineId);
    const exact = activePanels.find((panel) => panel.id === value);
    if (exact !== undefined) return exact.id;
    const aliases = activePanels.filter((panel) => panel.routeAliases?.includes(value) === true);
    if (aliases.length === 1) return aliases[0]?.id;
    if (aliases.length > 1) console.warn(`Ambiguous PI WEB workspace panel route: ${value}`);
    return undefined;
  }

  async invalidateWorkspacePanels(context: WorkspacePanelContext, panelId?: QualifiedContributionId): Promise<void> {
    await Promise.all(this.workspacePanels.map(async (panel) => {
      if (panel.onInvalidate === undefined || (panelId !== undefined && panel.id !== panelId)) return;
      try {
        await panel.onInvalidate(context);
      } catch (error) {
        console.warn(`Failed to invalidate PI WEB plugin panel ${panel.id}`, error);
      }
    }));
  }

  getThemes(): QualifiedThemeContribution[] {
    return [...this.themes].sort((left, right) => (left.order ?? 1000) - (right.order ?? 1000) || left.name.localeCompare(right.name));
  }

  getThemePairs(): QualifiedThemePairContribution[] {
    return [...this.themePairs].sort((left, right) => (left.order ?? 1000) - (right.order ?? 1000) || left.name.localeCompare(right.name));
  }

  getWorkspaceLabelItems(context: WorkspaceLabelContext): WorkspaceLabelItem[] {
    return [...this.workspaceLabels]
      .sort((left, right) => (left.order ?? 1000) - (right.order ?? 1000) || left.id.localeCompare(right.id))
      .flatMap((contribution) => {
        if (contribution.visible?.(context) === false) return [];
        return contribution.items(context);
      });
  }

  private qualifyAction(
    pluginId: string,
    action: PluginAction,
    machineId: string | undefined,
    sourcePluginId: string | undefined,
    contributionIds: Set<QualifiedContributionId>,
  ): RegisteredPluginAction {
    const id = this.qualify(pluginId, action.id, contributionIds);
    const sourceId = `${sourcePluginId ?? pluginId}:${action.id}`;
    const shortcutAliases = this.parseShortcutAliases(id, action.shortcutAliases, sourceId);
    return {
      ...action,
      id,
      pluginId,
      localId: action.id,
      ...(shortcutAliases.length === 0 ? {} : { shortcutAliases }),
      ...(machineId === undefined ? {} : { machineId }),
      ...(sourcePluginId === undefined ? {} : { sourcePluginId }),
    };
  }

  private qualifyWorkspacePanel(
    pluginId: string,
    panel: WorkspacePanelContribution,
    machineId: string | undefined,
    sourcePluginId: string | undefined,
    backendRevision: string | undefined,
    pairedRequestVersion: 1 | undefined,
    pairedChannelVersion: 1 | undefined,
    contributionIds: Set<QualifiedContributionId>,
  ): QualifiedWorkspacePanelContribution {
    const id = this.qualify(pluginId, panel.id, contributionIds);
    const fileOpenQuery = panel.fileOpenQuery;
    const badge = panel.badge;
    const visible = panel.visible;
    const onInvalidate = panel.onInvalidate;
    const binding = workspacePluginBinding(pluginId, sourcePluginId, backendRevision, pairedRequestVersion, pairedChannelVersion);
    const sourceId = `${sourcePluginId ?? pluginId}:${panel.id}`;
    const routeAliases = this.parseRouteAliases(id, panel.routeAliases, sourceId);
    return {
      ...panel,
      id,
      pluginId,
      localId: panel.id,
      ...(routeAliases.length === 0 ? {} : { routeAliases }),
      ...(machineId === undefined ? {} : { machineId }),
      ...(sourcePluginId === undefined ? {} : { sourcePluginId }),
      visible: (context: WorkspacePanelContext) => this.isContributionActive(pluginId, machineId, context.machine.id, sourcePluginId) && (visible?.(workspacePanelContextFor(context, binding)) ?? true),
      ...(fileOpenQuery === undefined ? {} : { fileOpenQuery: (context: WorkspacePanelContext, path: string) => this.isContributionActive(pluginId, machineId, context.machine.id, sourcePluginId) ? fileOpenQuery(workspacePanelContextFor(context, binding), path) : undefined }),
      ...(badge === undefined ? {} : { badge: (context: WorkspacePanelContext) => this.isContributionActive(pluginId, machineId, context.machine.id, sourcePluginId) ? badge(workspacePanelContextFor(context, binding)) : undefined }),
      ...(onInvalidate === undefined ? {} : { onInvalidate: (context: WorkspacePanelContext) => this.isContributionActive(pluginId, machineId, context.machine.id, sourcePluginId) ? onInvalidate(workspacePanelContextFor(context, binding)) : undefined }),
      render: (context: WorkspacePanelContext) => panel.render(workspacePanelContextFor(context, binding)),
    };
  }

  private qualifyWorkspaceLabelContribution(
    pluginId: string,
    contribution: WorkspaceLabelContribution,
    machineId: string | undefined,
    sourcePluginId: string | undefined,
    backendRevision: string | undefined,
    pairedRequestVersion: 1 | undefined,
    pairedChannelVersion: 1 | undefined,
    contributionIds: Set<QualifiedContributionId>,
  ): QualifiedWorkspaceLabelContribution {
    const id = this.qualify(pluginId, contribution.id, contributionIds);
    const visible = contribution.visible;
    const items = contribution.items;
    const binding = workspacePluginBinding(pluginId, sourcePluginId, backendRevision, pairedRequestVersion, pairedChannelVersion);
    return {
      ...contribution,
      id,
      pluginId,
      localId: contribution.id,
      ...(machineId === undefined ? {} : { machineId }),
      visible: (context) => this.isContributionActive(pluginId, machineId, context.machine.id, sourcePluginId) && (visible?.(workspaceLabelContextFor(context, binding)) ?? true),
      items: (context) => this.isContributionActive(pluginId, machineId, context.machine.id, sourcePluginId) ? items(workspaceLabelContextFor(context, binding)) : [],
    };
  }

  private qualifyTheme(pluginId: string, theme: ThemeContribution, contributionIds: Set<QualifiedContributionId>): QualifiedThemeContribution {
    const id = this.qualify(pluginId, theme.id, contributionIds);
    return { ...theme, id, pluginId, localId: theme.id };
  }

  private qualifyThemePair(pluginId: string, pair: ThemePairContribution, contributionIds: Set<QualifiedContributionId>): QualifiedThemePairContribution {
    const id = this.qualify(pluginId, pair.id, contributionIds);
    return {
      ...pair,
      id,
      pluginId,
      localId: pair.id,
      light: this.qualifyReference(pluginId, pair.light),
      dark: this.qualifyReference(pluginId, pair.dark),
    };
  }

  private qualify(pluginId: string, localId: string, contributionIds: Set<QualifiedContributionId>): QualifiedContributionId {
    this.validateLocalId(localId);
    const qualified: QualifiedContributionId = `${pluginId}:${localId}`;
    if (this.contributionIds.has(qualified) || contributionIds.has(qualified)) throw new Error(`Duplicate contribution id: ${qualified}`);
    contributionIds.add(qualified);
    return qualified;
  }

  private qualifyReference(pluginId: string, localId: string): QualifiedContributionId {
    this.validateLocalId(localId);
    return `${pluginId}:${localId}`;
  }

  private activeWorkspacePanels(selectedMachineId: string): QualifiedWorkspacePanelContribution[] {
    return this.workspacePanels.filter((panel) => this.isContributionActive(panel.pluginId, panel.machineId, selectedMachineId, panel.sourcePluginId));
  }

  private isContributionActive(pluginId: string, machineId: string | undefined, selectedMachineId: string, sourcePluginId: string | undefined): boolean {
    if (machineId === undefined) return !this.isGatewayPluginHiddenForMachine(pluginId, selectedMachineId);
    return machineId === selectedMachineId && !this.isRemotePluginHiddenByGateway(sourcePluginId, machineId);
  }

  private isRemoteDuplicateHiddenByGateway(sourcePluginId: string | undefined, machineId: string | undefined, machineSpecific: boolean): boolean {
    return sourcePluginId !== undefined
      && machineId !== undefined
      && this.gatewayPluginIds.has(sourcePluginId)
      && !this.gatewayMachineSpecificPluginIds.has(sourcePluginId)
      && !machineSpecific;
  }

  private isRemotePluginHiddenByGateway(sourcePluginId: string | undefined, machineId: string): boolean {
    if (sourcePluginId === undefined) return false;
    if (this.gatewayMachineSpecificPluginIds.has(sourcePluginId)) return false;
    if (this.remoteMachineSpecificPluginIds.get(sourcePluginId)?.has(machineId) === true) return false;
    return this.gatewayPluginIds.has(sourcePluginId);
  }

  private isGatewayPluginHiddenForMachine(pluginId: string, machineId: string): boolean {
    return machineId !== "local" && (
      this.gatewayMachineSpecificPluginIds.has(pluginId)
      || this.remoteMachineSpecificPluginIds.get(pluginId)?.has(machineId) === true
    );
  }

  private parseShortcutAliases(id: QualifiedContributionId, aliases: readonly string[] | undefined, sourceId: string): QualifiedContributionId[] {
    const parsed = [...new Set([...(aliases ?? []), sourceId])].filter((alias) => alias !== id);
    const invalid = parsed.find((alias) => !isQualifiedContributionId(alias));
    if (invalid !== undefined) throw new Error(`Invalid shortcut alias for ${id}: ${invalid}`);
    return parsed.filter(isQualifiedContributionId);
  }

  private parseRouteAliases(id: QualifiedContributionId, aliases: readonly string[] | undefined, sourceId: string): string[] {
    const parsed = [...new Set([...(aliases ?? []), sourceId])].filter((alias) => alias !== id);
    for (const alias of parsed) {
      if (!routeAliasPattern.test(alias)) throw new Error(`Invalid workspace panel route alias for ${id}: ${alias}`);
    }
    return parsed;
  }

  private validatePluginId(pluginId: string): void {
    if (!idPattern.test(pluginId)) throw new Error(`Invalid plugin id: ${pluginId}`);
  }

  private validateLocalId(localId: string): void {
    if (!localIdPattern.test(localId)) throw new Error(`Invalid contribution id: ${localId}`);
  }

  private parseBackendRevision(pluginId: string, value: unknown): string | undefined {
    if (value === undefined) return undefined;
    try {
      return requirePluginBackendRevision(value);
    } catch {
      throw new Error(`Invalid plugin backend revision for ${pluginId}`);
    }
  }

  private parsePairedCapabilityVersions(
    pluginId: string,
    registration: PiWebPluginRegistration,
    backendRevision: string | undefined,
  ): void {
    this.parsePairedCapabilityVersion(pluginId, "request", registration.pairedRequestVersion, backendRevision);
    this.parsePairedCapabilityVersion(pluginId, "channel", registration.pairedChannelVersion, backendRevision);
  }

  private parsePairedCapabilityVersion(
    pluginId: string,
    capability: "request" | "channel",
    value: unknown,
    backendRevision: string | undefined,
  ): 1 | undefined {
    if (value === undefined) return undefined;
    if (value !== 1 || backendRevision === undefined) {
      throw new Error(`Invalid plugin paired ${capability} version for ${pluginId}`);
    }
    return 1;
  }

  private parseMachineSpecific(pluginId: string, value: unknown): boolean {
    if (value === undefined) return false;
    if (typeof value !== "boolean") throw new Error(`Invalid plugin machineSpecific value for ${pluginId}: ${formatUnknownValue(value)}`);
    return value;
  }
}

function linkAbortSignals(primary: AbortSignal, lifetime: AbortSignal): AbortSignal {
  if (primary.aborted || lifetime.aborted) {
    const aborted = new AbortController();
    aborted.abort(primary.aborted ? primary.reason : lifetime.reason);
    return aborted.signal;
  }
  const linked = new AbortController();
  const abort = () => { linked.abort(primary.aborted ? primary.reason : lifetime.reason); };
  primary.addEventListener("abort", abort, { once: true });
  lifetime.addEventListener("abort", abort, { once: true });
  return linked.signal;
}

function capabilityKey(capability: PluginCapability): string {
  if (!idPattern.test(capability.pluginId) || !localIdPattern.test(capability.id) || !Number.isSafeInteger(capability.version) || capability.version < 1 || typeof capability.parse !== "function") {
    throw new Error("Invalid browser plugin capability");
  }
  return `${capability.pluginId}:${capability.id}@${String(capability.version)}`;
}
function pluginRuntimeContextFor(context: PluginRuntimeContext, pluginId: string): PluginRuntimeContext {
  return pluginRuntimeScopes.get(context)?.(pluginId) ?? context;
}

function workspacePanelContextFor(context: WorkspacePanelContext, binding: WorkspacePluginBinding): WorkspacePanelContext {
  return workspacePanelScopes.get(context)?.(binding) ?? context;
}

function workspaceLabelContextFor(context: WorkspaceLabelContext, binding: WorkspacePluginBinding): WorkspaceLabelContext {
  return workspaceLabelScopes.get(context)?.(binding) ?? context;
}

export function installPluginRuntimeScope(context: PluginRuntimeContext, scope: (pluginId: string) => PluginRuntimeContext): PluginRuntimeContext {
  pluginRuntimeScopes.set(context, scope);
  return context;
}

export function installWorkspacePanelScope(
  context: WorkspacePanelContext,
  scope: (binding: WorkspacePluginBinding) => WorkspacePanelContext,
): WorkspacePanelContext {
  workspacePanelScopes.set(context, scope);
  return context;
}

export function installWorkspaceLabelScope(
  context: WorkspaceLabelContext,
  scope: (binding: WorkspacePluginBinding) => WorkspaceLabelContext,
): WorkspaceLabelContext {
  workspaceLabelScopes.set(context, scope);
  return context;
}

function workspacePluginBinding(
  registrationPluginId: string,
  sourcePluginId: string | undefined,
  backendRevision: string | undefined,
  pairedRequestVersion: 1 | undefined,
  pairedChannelVersion: 1 | undefined,
): WorkspacePluginBinding {
  return Object.freeze({
    registrationPluginId,
    sourcePluginId: sourcePluginId ?? registrationPluginId,
    ...(backendRevision === undefined ? {} : { backendRevision }),
    ...(pairedRequestVersion === undefined ? {} : { pairedRequestVersion }),
    ...(pairedChannelVersion === undefined ? {} : { pairedChannelVersion }),
  });
}

function addMappedSetValue(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, new Set([value]));
  else existing.add(value);
}

function isQualifiedContributionId(value: string): value is QualifiedContributionId {
  return qualifiedContributionIdPattern.test(value);
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function" || value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function runtimeContextMachineId(context: PluginRuntimeContext): string {
  return context.state.selectedMachine?.id ?? "local";
}
