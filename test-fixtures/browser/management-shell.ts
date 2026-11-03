import { PiWebApp } from "../../src/client/src/components/PiWebApp";
import { initialAppState } from "../../src/client/src/appState";
import { trustApi, type SessionInfo } from "../../src/client/src/api";
import { NavigationOrderController } from "../../src/client/src/controllers/navigationOrderController";

const parameters = new URLSearchParams(location.search);
const pins = parameters.has("pins");
history.replaceState({}, "", `${location.pathname}?${parameters.get("mode") === "normal" ? "" : "embed=management&"}${pins ? "pins" : ""}`);
const app = new PiWebApp();
// Exercise the actual shell without starting daemon connections or polling.
Reflect.set(app, "initializeNormalAuth", () => Promise.resolve());
if (pins) {
  trustApi.workspaceTrust = () => Promise.resolve({ path: "/repo", decision: false, trusted: false });
  const project = { id: "p", name: "Project", path: "/repo", createdAt: "now" };
  const workspace = { id: "w", projectId: "p", path: "/repo", label: "Workspace", isMain: true, effectiveConfig: {} };
  const session = (id: string): SessionInfo => ({ id, name: id, path: `/sessions/${id}.jsonl`, cwd: "/repo", created: "2026-10-01", modified: "2026-10-01", messageCount: 1, firstMessage: id, persisted: true });
  Reflect.set(app, "normalAuthLoading", false);
  Reflect.set(app, "normalAuthStatus", { configured: true, authenticated: true });
  Reflect.set(app, "state", { ...initialAppState(), projects: [project], selectedProject: project, workspaces: [workspace], selectedWorkspace: workspace, sessions: [session("one"), session("two")] });
  const controller: unknown = Reflect.get(app, "navigationOrder");
  if (!(controller instanceof NavigationOrderController)) throw new Error("Missing navigation order controller");
  await controller.ensure({ kind: "sessionPins", machineId: "local", projectId: "p", workspaceId: "w" });
}
document.body.append(app);
await app.updateComplete;
document.body.dataset["ready"] = "true";
