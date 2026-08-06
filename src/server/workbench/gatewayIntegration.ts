import { createHash, randomBytes } from "node:crypto";
import type { PiWebWorkbenchIntegrationConfig } from "../../shared/apiTypes.js";
import type { SessionProxyDaemon } from "../sessiond/sessionProxyRoutes.js";
import type { ManagementEmbedContext, ManagementEmbedRuntime } from "../managementEmbed.js";
import { WorkbenchClient } from "./workbenchClient.js";
import { WORKBENCH_ACCESS_STATE_ROUTE } from "./accessStateRoutes.js";

interface WorkbenchBinding {
  handle: string;
  expiresAt: number;
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
  const handles = new WeakMap<ManagementEmbedContext, string>();
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
          (binding) => { created.expiresAt = Math.min(created.expiresAt, binding.expiresAt); },
          () => { if (bindings.get(key) === created) bindings.delete(key); },
        );
      }
      const binding = await cached.pending;
      handles.set(context, binding.handle);
      return context;
    },
    resourceHandle(context) {
      return handles.get(context);
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
  const response = await daemon.request("PUT", `${WORKBENCH_ACCESS_STATE_ROUTE}/${encodeURIComponent(handle)}`, state);
  if (response.statusCode !== 204) {
    await client.revoke(state).catch(() => undefined);
    throw new Error("Session daemon rejected the workbench resource state");
  }
  return {
    handle,
    expiresAt: Math.min(expiryTime(entryExpiresAt), expiryTime(state.expiresAt)),
  };
}

function expiryTime(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
