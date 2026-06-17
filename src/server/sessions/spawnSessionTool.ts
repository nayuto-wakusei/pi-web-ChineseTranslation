import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export interface SpawnSessionResult {
  sessionId: string;
  cwd: string;
}

export interface SpawnSessionInvocation {
  spawningCwd: string;
  prompt: string;
  cwd: string | undefined;
}

export interface SpawnSessionToolDeps {
  spawn(input: SpawnSessionInvocation): Promise<SpawnSessionResult>;
}

type SpawnSessionToolDetails = SpawnSessionResult;

const SpawnSessionParams = Type.Object({
  prompt: Type.String({
    description: "The first instruction to send to the newly created session. The new session runs independently; you do not receive its output.",
  }),
  cwd: Type.Optional(Type.String({
    description: "Working directory for the new session. Must be a workspace (worktree, or root) of the same project as this session. Defaults to this session's working directory.",
  })),
});

/**
 * Custom tool that lets the LLM start a new, independent pi-web session and
 * deliver an initial prompt to it. The spawned session is a normal pi-web session
 * a human can open and interact with. The tool is constructed per-session, so it
 * carries the spawning session's cwd for project-scope validation.
 */
export function createSpawnSessionToolDefinition(spawningCwd: string, deps: SpawnSessionToolDeps) {
  return defineTool<typeof SpawnSessionParams, SpawnSessionToolDetails>({
    name: "spawn_session",
    label: "Spawn session",
    description: "Start a new, independent pi-web session and send it an initial prompt. Use this to dispatch a fresh agent to continue work or follow a plan. The new session runs on its own and a human can interact with it; you do not receive its output.",
    promptSnippet: "spawn_session: start a new independent session with a first prompt",
    parameters: SpawnSessionParams,
    async execute(_toolCallId, params) {
      // Failures throw: the agent loop turns the thrown message into an error
      // tool result the model sees, so the spawning agent can adapt (e.g. pick a
      // valid workspace) rather than crash.
      const result = await deps.spawn({ spawningCwd, prompt: params.prompt, cwd: params.cwd });
      return {
        content: [{ type: "text", text: `Started session ${result.sessionId} in ${result.cwd}.` }],
        details: result,
      };
    },
  });
}
