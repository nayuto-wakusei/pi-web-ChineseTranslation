import { pluginsApi, type Machine } from "../api";
import { isManagementEmbedMode } from "../api/managementEmbed";
import { loadExternalPlugins, type ExternalPluginLoadResult, type PluginManifestEntry } from "./external";

type RegisterPlugins = (label: string, load: () => Promise<ExternalPluginLoadResult>) => Promise<boolean>;

export class MachinePluginLoadCoordinator {
  private gatewayLoad: Promise<boolean> | undefined;
  private readonly loadedMachineIds = new Set<string>();
  private readonly machineLoads = new Map<string, Promise<void>>();

  constructor(
    private readonly registerPlugins: RegisterPlugins,
    private readonly shouldLoadRemotePlugin: (id: string, machineSpecific: boolean) => boolean,
  ) {}

  ensureGatewayLoaded(): Promise<boolean> {
    this.gatewayLoad ??= this.registerPlugins("PI WEB 插件", async () => {
      const plugins = await managementPluginEntries();
      return loadExternalPlugins("pi-web-plugins/manifest.json", plugins === undefined ? {} : { plugins });
    });
    return this.gatewayLoad;
  }

  async loadForMachine(machine: Machine): Promise<void> {
    await this.ensureGatewayLoaded();
    if (machine.kind !== "remote" || this.loadedMachineIds.has(machine.id)) return;
    const existing = this.machineLoads.get(machine.id);
    if (existing !== undefined) return existing;

    const load = this.registerPlugins(
      `来自 ${machine.name} 的 PI WEB 插件`,
      () => loadExternalPlugins(`api/machines/${encodeURIComponent(machine.id)}/pi-web-plugins/manifest.json`, {
        machineId: machine.id,
        shouldLoadPlugin: (entry) => this.shouldLoadRemotePlugin(entry.id, entry.machineSpecific),
      }),
    )
      .then((loaded) => { if (loaded) this.loadedMachineIds.add(machine.id); })
      .finally(() => { this.machineLoads.delete(machine.id); });
    this.machineLoads.set(machine.id, load);
    await load;
  }
}

async function managementPluginEntries(): Promise<readonly PluginManifestEntry[] | undefined> {
  if (!isManagementEmbedMode()) return undefined;
  const response = await pluginsApi.plugins();
  return response.plugins.flatMap((plugin) => !plugin.enabled || plugin.module === undefined ? [] : [{
    id: plugin.id,
    module: plugin.module,
    source: plugin.source,
    scope: plugin.scope,
    machineSpecific: plugin.machineSpecific,
    ...(plugin.backendRevision === undefined ? {} : { backendRevision: plugin.backendRevision }),
    ...(plugin.pairedRequestVersion === undefined ? {} : { pairedRequestVersion: plugin.pairedRequestVersion }),
    ...(plugin.pairedChannelVersion === undefined ? {} : { pairedChannelVersion: plugin.pairedChannelVersion }),
  }]);
}
