import type { PiWebPluginV5, PluginActivationContextV5, PluginRuntimeContextV5 } from "@chainingintention/pi-web-cn/plugin-api";
import { openWorktreeDialog } from "./worktreeDialog.js";
import definitions from "./workflows.messages.js";

type WorktreeContext = Pick<PluginRuntimeContextV5, "state" | "backend" | "catalog" | "navigate">;
function canCreateWorktree({ state, backend }: Pick<WorktreeContext, "state" | "backend">): boolean {
  return state.selectedProject !== undefined && backend !== undefined;
}

const plugin = {
  apiVersion: 5,
  name: "Workflows",
  activate: ({ lifetimeSignal, selection, localization }: Pick<PluginActivationContextV5, "lifetimeSignal" | "selection" | "localization">) => {
    if (!localization) throw new Error("The Workflows plugin requires a localization-capable PI WEB host");
    const messages = localization.registerMessages("worktree", definitions);
    let closeDialog: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    const close = () => { closeDialog?.(); closeDialog = undefined; unsubscribe?.(); unsubscribe = undefined; };
    lifetimeSignal.addEventListener("abort", close, { once: true });
    return {
      contributions: {
        actions: [{
          id: "worktree.create",
          get title() { return messages.t("action"); },
          get description() { return messages.t("actionDescription"); },
          get group() { return messages.t("group"); },
          enabled: canCreateWorktree,
          disabledReason: () => messages.t("disabled"),
          run: (context: WorktreeContext) => {
            const project = context.state.selectedProject;
            if (!project || !context.backend || lifetimeSignal.aborted) return;
            close();
            const peer = context.backend.forScope({ kind: "project", projectId: project.id });
            closeDialog = openWorktreeDialog(context, peer, localization, messages, () => { closeDialog = undefined; unsubscribe?.(); unsubscribe = undefined; });
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
