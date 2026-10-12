import type { ManagementEmbedContext } from "./managementEmbed.js";

export interface ManagementPrivileges {
  bash: boolean;
  network: boolean;
  full?: boolean;
}

export const DISABLED_MANAGEMENT_PRIVILEGES: ManagementPrivileges = { bash: false, network: false };

export function managementPrivileges(
  context: Pick<ManagementEmbedContext, "privileged" | "tools">,
  options: { allowPrivileged?: boolean } = {},
): ManagementPrivileges {
  if (options.allowPrivileged !== true) return { ...DISABLED_MANAGEMENT_PRIVILEGES };
  if (managementUsesNormalPermissions(context, options)) return { bash: true, network: true, full: true };
  const deny = new Set(context.tools?.deny ?? []);
  return {
    bash: context.privileged?.bash === true && !deny.has("bash"),
    network: context.privileged?.network === true,
  };
}

export function managementUsesNormalPermissions(
  context: Pick<ManagementEmbedContext, "privileged">,
  options: { allowPrivileged?: boolean } = {},
): boolean {
  return options.allowPrivileged === true
    && context.privileged?.bash === true
    && context.privileged.network === true;
}

export function managementPrivilegeRequested(context: Pick<ManagementEmbedContext, "privileged">): boolean {
  return context.privileged?.bash === true || context.privileged?.network === true;
}
