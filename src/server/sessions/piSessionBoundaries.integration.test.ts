import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type AgentBeforeSettleEvent, type TurnEndEvent, type TurnEndEventResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createTestModelRuntime, seedCredential, TEST_MODEL_ID, TEST_MODEL_PROVIDER } from "./piSessionService.testSupport.js";
import { toClientEvent } from "./sessionUiEvents.js";
import { historyMessagesFromEntries } from "./transcriptMessages.js";

describe("Pi boundary transcript compatibility", () => {
  it.each((["turn_end", "agent_before_settle"] as const).flatMap((boundary) => [
    { boundary, compact: false }, { boundary, compact: true },
  ]))("appends $boundary drafts (compact=$compact) without rewriting raw history", async ({ boundary, compact }) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-boundaries-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      const credentials = new InMemoryCredentialStore();
      await seedCredential(credentials, TEST_MODEL_PROVIDER, { type: "api_key", key: "isolated-test-key" });
      const modelRuntime = await createTestModelRuntime(credentials);
      const model = modelRuntime.getModel(TEST_MODEL_PROVIDER, TEST_MODEL_ID);
      if (model === undefined) throw new Error("Expected the SDK model catalog entry");
      const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
      const manager = SessionManager.inMemory(directory);
      let dispatched = false;
      const loader = new DefaultResourceLoader({
        cwd: directory, agentDir: directory, settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        agentsFilesOverride: () => ({ agentsFiles: [] }),
        extensionFactories: [(pi) => {
          const handleBoundary = (event: TurnEndEvent | AgentBeforeSettleEvent): TurnEndEventResult | undefined => {
            if (dispatched) return;
            dispatched = true;
            const assistant = manager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "assistant");
            if (assistant === undefined) throw new Error("Boundary must observe a persisted assistant");
            return {
              entries: [...event.entries,
                compact
                  ? { type: "compaction", summary: "Boundary summary", firstKeptEntryId: null }
                  : { type: "context_edit", targetId: assistant.id, replacement: null },
                { type: "custom", customType: "metadata", data: { internal: true } },
                { type: "custom_message", customType: "hidden", content: "Hidden context", display: false },
                { type: "custom_message", customType: "visible", content: "Continue from boundary", display: true },
              ],
              continue: true,
            };
          };
          if (boundary === "turn_end") pi.on("turn_end", handleBoundary);
          else pi.on("agent_before_settle", handleBoundary);
        }],
      });
      await loader.reload();
      ({ session } = await createAgentSession({
        cwd: directory, agentDir: directory, sessionManager: manager, settingsManager,
        resourceLoader: loader, modelRuntime, model, noTools: "all",
      }));
      const uiEvents: ReturnType<typeof toClientEvent>[] = [];
      session.subscribe((event) => { uiEvents.push(toClientEvent(event, session?.thinkingLevel)); });
      const requests: unknown[] = [];
      session.agent.streamFunction = (_model, context) => {
        requests.push(structuredClone(context.messages));
        const message: AssistantMessage = {
          role: "assistant", content: [{ type: "text", text: requests.length === 1 ? "Original answer" : "Continued answer" }],
          api: "anthropic-messages", provider: TEST_MODEL_PROVIDER, model: TEST_MODEL_ID,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop", timestamp: Date.now(),
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
        return stream;
      };

      await session.prompt("Initial prompt");
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1])).not.toContain("Original answer");
      expect(JSON.stringify(requests[1])).toContain("Continue from boundary");
      expect(JSON.stringify(requests[1])).toContain("Hidden context");

      const history = historyMessagesFromEntries(manager.getBranch());
      expect(history).toContainEqual(expect.objectContaining({ role: "assistant", content: [{ type: "text", text: "Original answer" }] }));
      const visible = history.find((message) => typeof message === "object" && message !== null && "customType" in message && message.customType === "visible");
      expect(visible).toHaveProperty("content", "Continue from boundary");
      const appended = uiEvents.filter((event) => event.type === "message.append");
      expect(appended).toHaveLength(compact ? 2 : 1);
      if (compact) expect(appended[0]).toMatchObject({ type: "message.append", message: { role: "system", source: "compaction" } });
      expect(appended.at(-1)).toEqual({ type: "message.append", message: visible });
    } finally {
      session?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
