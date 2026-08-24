import { createHash, randomBytes } from "node:crypto";
import type { PiWebWorkbenchIntegrationConfig } from "../../shared/apiTypes.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";
import type { ManagementEmbedContext, ManagementEmbedRuntime } from "../managementEmbed.js";
import type { WorkbenchAgentAccessState } from "./types.js";
import { WorkbenchClient } from "./workbenchClient.js";
import { WORKBENCH_ACCESS_STATE_ROUTE } from "./accessStateRoutes.js";

interface WorkbenchBinding {
  handle: string;
  bootstrapToken: string;
  projectId: string;
  entryExpiresAt: number;
  state: WorkbenchAgentAccessState;
  refresh?: Promise<void>;
}

interface CachedWorkbenchBinding {
  expiresAt: number;
  pending: Promise<WorkbenchBinding>;
}

export function createWorkbenchManagementRuntime(
  base: ManagementEmbedRuntime | undefined,
  config: PiWebWorkbenchIntegrationConfig | undefined,
  daemon: SessionProxyDaemon,
): ManagementEmbedRuntime | undefined {
  if (base === undefined || config === undefined) return base;
  const contextBindings = new WeakMap<ManagementEmbedContext, WorkbenchBinding>();
  const bindings = new Map<string, CachedWorkbenchBinding>();
  const client = new WorkbenchClient({ baseUrl: config.baseUrl, requestTimeoutMs: config.requestTimeoutMs ?? 10_000 });
  return {
    ...base,
    async authenticate(token) {
      const context = await base.authenticate(token);
      const now = Date.now();
      for (const [key, binding] of bindings) {
        if (binding.expiresAt <= now) bindings.delete(key);
      }
      const key = createHash("sha256").update(token).digest("base64url");
      let cached = bindings.get(key);
      if (cached === undefined) {
        const projectId = context.projects[0]?.id ?? "personal-project";
        const pending = createWorkbenchBinding(client, daemon, token, projectId, context.expiresAt);
        const created = { expiresAt: expiryTime(context.expiresAt), pending };
        cached = created;
        bindings.set(key, created);
        void pending.then(
          () => undefined,
          () => { if (bindings.get(key) === created) bindings.delete(key); },
        );
      }
      const binding = await cached.pending;
      contextBindings.set(context, binding);
      return context;
    },
    async prepareContext(context) {
      const binding = contextBindings.get(context);
      if (binding !== undefined) await refreshExpiredWorkbenchBinding(client, daemon, binding);
    },
    resourceHandle(context) {
      return contextBindings.get(context)?.handle;
    },
  };
}

async function createWorkbenchBinding(
  client: WorkbenchClient,
  daemon: SessionProxyDaemon,
  token: string,
  projectId: string,
  entryExpiresAt: string | undefined,
): Promise<WorkbenchBinding> {
  const state = await client.createAgentAccessState(token, projectId);
  const handle = randomBytes(32).toString("base64url");
  await storeWorkbenchState(client, daemon, handle, state);
  return {
    handle,
    bootstrapToken: token,
    projectId,
    entryExpiresAt: expiryTime(entryExpiresAt),
    state,
  };
}

async function refreshExpiredWorkbenchBinding(client: WorkbenchClient, daemon: SessionProxyDaemon, binding: WorkbenchBinding): Promise<void> {
  const now = Date.now();
  if (expiryTime(binding.state.expiresAt) > now) return;
  if (binding.entryExpiresAt <= now) throw new Error("当前资源授权已过期，请返回工作台重新进入桂小智。");
  if (binding.refresh === undefined) {
    const pending = refreshWorkbenchBinding(client, daemon, binding).finally(() => {
      if (binding.refresh === pending) delete binding.refresh;
    });
    binding.refresh = pending;
  }
  await binding.refresh;
}

async function refreshWorkbenchBinding(client: WorkbenchClient, daemon: SessionProxyDaemon, binding: WorkbenchBinding): Promise<void> {
  const state = await client.createAgentAccessState(binding.bootstrapToken, binding.projectId);
  await storeWorkbenchState(client, daemon, binding.handle, state);
  binding.state = state;
}

async function storeWorkbenchState(
  client: WorkbenchClient,
  daemon: SessionProxyDaemon,
  handle: string,
  state: WorkbenchAgentAccessState,
): Promise<void> {
  const response = await daemon.request("PUT", `${WORKBENCH_ACCESS_STATE_ROUTE}/${encodeURIComponent(handle)}`, state);
  if (response.statusCode === 204) return;
  await client.revoke(state).catch(() => undefined);
  throw new Error("Session daemon rejected the workbench resource state");
}

function expiryTime(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
