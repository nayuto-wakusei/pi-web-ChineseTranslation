import type { PiWebPluginV5, PluginActivationContextV5, PluginRuntimeContextV5 } from "@chainingintention/pi-web-cn/plugin-api";
import { openWorktreeDialog } from "./worktreeDialog.js";

type WorktreeContext = Pick<PluginRuntimeContextV5, "state" | "backend" | "catalog" | "navigate">;
function canCreateWorktree({ state, backend }: Pick<WorktreeContext, "state" | "backend">): boolean {
  return state.selectedProject !== undefined && backend !== undefined;
}

const plugin = {
  apiVersion: 5,
  name: "Workflows",
  activate: ({ lifetimeSignal, selection, translate }: Pick<PluginActivationContextV5, "lifetimeSignal" | "selection" | "translate">) => {
    const t = translate ?? ((_key: string, fallback: string) => fallback);
    let closeDialog: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    const close = () => { closeDialog?.(); closeDialog = undefined; unsubscribe?.(); unsubscribe = undefined; };
    lifetimeSignal.addEventListener("abort", close, { once: true });
    return {
      contributions: {
        actions: [{
          id: "worktree.create",
          title: t("bundled.workflows.create.worktree", "Create Worktree"),
          description: t("bundled.workflows.create.description", "Choose a base branch and purpose, then start a new conversation in the main workspace"),
          group: t("bundled.workflows.group", "Workflows"),
          enabled: canCreateWorktree,
          disabledReason: () => t("bundled.workflows.select.project", "Select a project with the Workflows backend available first."),
          run: (context: WorktreeContext) => {
            const project = context.state.selectedProject;
            if (!project || !context.backend || lifetimeSignal.aborted) return;
            close();
            const peer = context.backend.forScope({ kind: "project", projectId: project.id });
            closeDialog = openWorktreeDialog(context, peer, () => { closeDialog = undefined; unsubscribe?.(); unsubscribe = undefined; }, translate);
            unsubscribe = selection?.subscribe((snapshot) => {
              if (snapshot.selectedProject?.id !== project.id || snapshot.selectedMachine?.id !== context.catalog.machineId) close();
            });
          },
        }],
      },
      dispose() { close(); lifetimeSignal.removeEventListener("abort", close); },
    };
  },
} satisfies PiWebPluginV5;

export default plugin;
