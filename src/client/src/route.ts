import type { QualifiedContributionId } from "./plugins/types";

/** A qualified panel id, or a short URL alias such as `terminal` that a panel claims. */
export type WorkspacePanelRouteId = QualifiedContributionId | "terminal";

export interface AppRoute {
  machineId: string | undefined;
  projectId: string | undefined;
  workspaceId: string | undefined;
  sessionId: string | undefined;
  tool: WorkspacePanelRouteId | undefined;
  view: "chat" | WorkspacePanelRouteId | undefined;
}

export interface ParsedAppRoute extends Omit<AppRoute, "tool" | "view"> {
  tool: string | undefined;
  view: string | undefined;
}

export type WorkspacePanelRouteResolver = (value: string) => QualifiedContributionId | undefined;

export function resolveWorkspacePanelRouteValue(value: string | undefined, resolve: WorkspacePanelRouteResolver): QualifiedContributionId | undefined {
  if (value === undefined) return undefined;
  return resolve(value) ?? (isQualifiedId(value) ? value : undefined);
}

export interface SessionCreationRouteIdentity {
  machineId: string;
  projectId: string;
  workspaceId: string;
  sessionId: string;
}

/** Browser-owned creation identity, never a daemon session ID or a create command. */
export function isCreatingSessionId(sessionId: string | undefined): sessionId is `creating:${string}` {
  return sessionId?.startsWith("creating:") === true;
}

export function routeMatchesSessionCreation(route: ParsedAppRoute, identity: SessionCreationRouteIdentity): boolean {
  return (route.machineId ?? "local") === identity.machineId
    && route.projectId === identity.projectId
    && route.workspaceId === identity.workspaceId
    && route.sessionId === identity.sessionId;
}

export function readRoute(): ParsedAppRoute {
  const params = new URLSearchParams(window.location.search);
  return {
    machineId: params.get("machine") ?? undefined,
    projectId: params.get("project") ?? undefined,
    workspaceId: params.get("workspace") ?? undefined,
    sessionId: params.get("session") ?? undefined,
    tool: nonEmpty(params.get("tool")),
    view: nonEmpty(params.get("view")),
  };
}

export function writeRoute(route: ParsedAppRoute, options?: { replace?: boolean | undefined }): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("machine");
  url.searchParams.delete("project");
  url.searchParams.delete("workspace");
  url.searchParams.delete("session");
  url.searchParams.delete("tool");
  url.searchParams.delete("view");
  if (route.machineId !== undefined && route.machineId !== "" && route.machineId !== "local") url.searchParams.set("machine", route.machineId);
  if (route.projectId !== undefined && route.projectId !== "") url.searchParams.set("project", route.projectId);
  if (route.workspaceId !== undefined && route.workspaceId !== "") url.searchParams.set("workspace", route.workspaceId);
  if (route.sessionId !== undefined && route.sessionId !== "") url.searchParams.set("session", route.sessionId);
  if (route.tool !== undefined && route.tool !== "") url.searchParams.set("tool", route.tool);
  if (route.view !== undefined && route.view !== "") url.searchParams.set("view", route.view);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  if (options?.replace === true) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}

function nonEmpty(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function isQualifiedId(value: string | null): value is QualifiedContributionId {
  return value !== null && /^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/u.test(value);
}
