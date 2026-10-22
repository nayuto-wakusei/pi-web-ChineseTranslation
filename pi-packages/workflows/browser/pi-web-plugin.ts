import type { PiWebPlugin, PluginRuntimeContext } from "@chainingintention/pi-web-cn/plugin-api";

type WorktreePromptContext = Pick<PluginRuntimeContext, "state" | "prompt" | "focusPrompt">;

function canPrepareWorktreePrompt({ state, prompt }: Pick<WorktreePromptContext, "state" | "prompt">): boolean {
  const session = state.selectedSession;
  return state.mainView === "chat"
    && state.selectedWorkspace !== undefined
    && session !== undefined
    && !session.archived
    && !session.pending
    && prompt.getText() === "";
}

const plugin = {
  apiVersion: 4,
  name: "Workflows",
  activate: ({ translate = (_key, fallback) => fallback }) => ({
    contributions: {
      actions: [{
        id: "worktree.create",
        title: translate("bundled.workflows.create.worktree", "Create Worktree"),
        description: translate("bundled.workflows.prepare.worktree", "Prepare /worktree; describe its purpose and/or base branch before sending"),
        group: translate("bundled.workflows.group", "Workflows"),
        enabled: canPrepareWorktreePrompt,
        disabledReason: () => translate("bundled.workflows.select.conversation", "Select an active conversation in Chat with an empty prompt first."),
        run: (context: WorktreePromptContext) => {
          if (!canPrepareWorktreePrompt(context)) return;
          context.focusPrompt();
          context.prompt.insertText("/worktree ");
        },
      }],
    },
  }),
} satisfies Extract<PiWebPlugin, { apiVersion: 4 }>;

export default plugin;
