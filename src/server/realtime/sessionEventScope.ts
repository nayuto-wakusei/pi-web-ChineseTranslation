import type { ManagementEmbedContext } from "../managementEmbed.js";

export type SessionEventScope = string;
export type AuthScope = "normal" | "management";

export const NORMAL_SESSION_EVENT_SCOPE = "normal";

export function managementContextKey(context: ManagementEmbedContext | undefined): string | undefined {
  if (context === undefined) return undefined;
  return JSON.stringify({
    user: {
      id: context.user.id,
      rootUserId: context.user.rootUserId,
      roles: sortedStrings(context.user.roles),
      permissions: sortedStrings(context.user.permissions),
    },
    projects: context.projects
      .map((project) => ({ id: project.id, role: project.role, root: project.root }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    tools: context.tools === undefined ? undefined : {
      allow: sortedStrings(context.tools.allow),
      deny: sortedStrings(context.tools.deny),
      permissions: sortedRecord(context.tools.permissions),
    },
    sandbox: context.sandbox === undefined ? undefined : {
      pythonExecutable: context.sandbox.pythonExecutable,
      env: sortedRecord(context.sandbox.env),
    },
  });
}

export function eventScopeFromManagementContext(context: ManagementEmbedContext | undefined): SessionEventScope {
  const key = managementContextKey(context);
  return key === undefined ? NORMAL_SESSION_EVENT_SCOPE : `management:${key}`;
}

export function authScopeFromEventScope(scope: SessionEventScope): AuthScope {
  return scope === NORMAL_SESSION_EVENT_SCOPE ? "normal" : "management";
}

function sortedStrings(values: readonly string[] | undefined): string[] | undefined {
  return values === undefined ? undefined : [...values].sort();
}

function sortedRecord(values: Record<string, string | boolean> | undefined): Record<string, string | boolean> | undefined {
  if (values === undefined) return undefined;
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}
