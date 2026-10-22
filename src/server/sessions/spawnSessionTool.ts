// Server-only npm alias: native Node cannot use Pi's extension module mapping.
// Keep this out of extensions; see docs/development-checks.md#server-only-typebox.
import { Type } from "pi-web-typebox";
import { KNOWN_THINKING_LEVELS } from "../../shared/thinkingLevels.js";
import type { SessionUiMetadata } from "../../shared/pluginApiTypes.js";
import { defineTool, type ExtensionContext } from "../../piSdk.js";

export interface SpawnSessionResult {
  sessionId: string;
  cwd: string;
  /** Model the spawned session runs with, as `provider/id`; absent when unknown. */
  model?: string;
}

export type SpawnSessionModel = NonNullable<ExtensionContext["model"]>;
export type SpawnSessionThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;

export interface SpawnSessionInvocation {
  spawningCwd: string;
  /** Id of the dispatching session; used to resolve {@link modelSpec} against its model runtime. */
  spawningSessionId: string;
  prompt: string;
  cwd: string | undefined;
  /** Host/extension-supplied UI-safe state, installed before startup and the first prompt. */
  metadata?: SessionUiMetadata;
  /** Host/extension-supplied display name, installed before extensions and publication. */
  name?: string;
  /** Current model from the dispatching session, used as the spawned session's default. */
  model?: SpawnSessionModel;
  /** Strict `provider/model-id` requested by the dispatcher; overrides {@link model} when set. */
  modelSpec?: string;
  /** Explicit override or dispatching session's inherited thinking level (pi clamps it to the spawned model's capabilities). */
  thinkingLevel?: SpawnSessionThinkingLevel;
}

export interface SpawnSessionToolDeps {
  spawn(input: SpawnSessionInvocation): Promise<SpawnSessionResult>;
}

type SpawnSessionToolDetails = SpawnSessionResult;

const SpawnSessionParams = Type.Object({
  thinkingLevel: Type.Optional(Type.Enum(KNOWN_THINKING_LEVELS, {
    type: "string",
    description: "Thinking level override for the new session. Set this field only when instructed to use a specific thinking level or to choose an appropriate one. Otherwise omit it to inherit this session's thinking level. An unknown value is rejected; valid levels are clamped to the selected model's capabilities.",
  })),
  prompt: Type.String({
    description: "发送给新建会话的第一条指令。新会话会独立运行；你不会收到它的输出。",
  }),
  cwd: Type.Optional(Type.String({
    description: "新会话的工作目录。必须是与当前会话同一项目下的工作区（worktree 或根目录）。默认使用当前会话的工作目录。",
  })),
  model: Type.Optional(Type.String({
    description: '新会话的模型覆盖，必须是精确的“provider/model-id”。仅在明确要求使用指定模型或选择合适模型时填写。用户以 #provider/model-id 引用模型时传入该值；否则省略时继承当前会话模型。未知值会被拒绝。',
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
    description: "启动完全独立的会话，其记录与结果无法在这里获取。仅在用户或当前工作流明确要求单独会话时使用。",
    promptSnippet: "spawn_session：独立会话；此处无法获取结果；仅用于明确请求",
    parameters: SpawnSessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Failures throw: the agent loop turns the thrown message into an error
      // tool result the model sees, so the spawning agent can adapt (e.g. pick a
      // valid workspace) rather than crash.
      const thinkingLevel = params.thinkingLevel ?? ctx.thinkingLevel;
      const result = await deps.spawn({
        spawningCwd,
        spawningSessionId: ctx.sessionManager.getSessionId(),
        prompt: params.prompt,
        cwd: params.cwd,
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...(params.model === undefined ? {} : { modelSpec: params.model }),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      });
      const modelNote = result.model === undefined ? "" : `，使用模型 ${result.model}`;
      return {
        content: [{ type: "text", text: `已在 ${result.cwd} 启动独立会话 ${result.sessionId}${modelNote}。` }],
        details: result,
      };
    },
  });
}
