import type { ManagementEmbedContext } from "./managementEmbed.js";

export interface ManagementPrivileges {
  bash: boolean;
  network: boolean;
}

export const DISABLED_MANAGEMENT_PRIVILEGES: ManagementPrivileges = { bash: false, network: false };

export function managementPrivileges(
  context: Pick<ManagementEmbedContext, "privileged" | "tools">,
  options: { allowPrivileged?: boolean } = {},
): ManagementPrivileges {
  if (options.allowPrivileged !== true) return { ...DISABLED_MANAGEMENT_PRIVILEGES };
  const deny = new Set(context.tools?.deny ?? []);
  return {
    bash: context.privileged?.bash === true && !deny.has("bash"),
    network: context.privileged?.network === true,
  };
}

export function managementPrivilegeRequested(context: Pick<ManagementEmbedContext, "privileged">): boolean {
  return context.privileged?.bash === true || context.privileged?.network === true;
}
