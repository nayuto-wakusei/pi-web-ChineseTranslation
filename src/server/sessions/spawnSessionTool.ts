import { Type } from "typebox";
import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface SpawnSessionResult {
  sessionId: string;
  cwd: string;
  /** Model the spawned session runs with, as `provider/id`; absent when unknown. */
  model?: string;
}

export type SpawnSessionModel = NonNullable<ExtensionContext["model"]>;

export interface SpawnSessionInvocation {
  spawningCwd: string;
  /** Id of the dispatching session; used to resolve {@link modelSpec} against its model runtime. */
  spawningSessionId: string;
  prompt: string;
  cwd: string | undefined;
  /** Current model from the dispatching session, used as the spawned session's default. */
  model?: SpawnSessionModel;
  /** Strict `provider/model-id` requested by the dispatcher; overrides {@link model} when set. */
  modelSpec?: string;
}

export interface SpawnSessionToolDeps {
  spawn(input: SpawnSessionInvocation): Promise<SpawnSessionResult>;
}

type SpawnSessionToolDetails = SpawnSessionResult;

const SpawnSessionParams = Type.Object({
  prompt: Type.String({
    description: "发送给新建会话的第一条指令。新会话会独立运行；你不会收到它的输出。",
  }),
  cwd: Type.Optional(Type.String({
    description: "新会话的工作目录。必须是与当前会话同一项目下的工作区（worktree 或根目录）。默认使用当前会话的工作目录。",
  })),
  model: Type.Optional(Type.String({
    description: '新会话使用的模型，必须是精确的“provider/model-id”，例如“anthropic/claude-sonnet-4-5”。当用户在请求中以 #provider/model-id 引用模型时，将该值传入这里。未知值会被拒绝；省略时继承当前会话的模型。',
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
    label: "派生会话",
    description: "启动一个新的独立 pi-web 会话，并发送初始提示。可用于派遣新的代理继续工作或执行计划。新会话会自行运行，人类可以打开并交互；你不会收到它的输出。",
    promptSnippet: "spawn_session：使用第一条提示启动新的独立会话",
    parameters: SpawnSessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Failures throw: the agent loop turns the thrown message into an error
      // tool result the model sees, so the spawning agent can adapt (e.g. pick a
      // valid workspace) rather than crash.
      const result = await deps.spawn({
        spawningCwd,
        spawningSessionId: ctx.sessionManager.getSessionId(),
        prompt: params.prompt,
        cwd: params.cwd,
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...(params.model === undefined ? {} : { modelSpec: params.model }),
      });
      const modelNote = result.model === undefined ? "" : `，使用模型 ${result.model}`;
      return {
        content: [{ type: "text", text: `已在 ${result.cwd} 启动独立会话 ${result.sessionId}${modelNote}。` }],
        details: result,
      };
    },
  });
}
