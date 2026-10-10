import { randomUUID } from "node:crypto";
import { PI_WEB_HOST_PI_SESSIONS_CAPABILITY, PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY } from "@chainingintention/pi-web-cn/server-plugin-api";
import type { PiWebHostPiSessionsV1, PiWebHostPiSessionEventsV1, PiWebServerPlugin, ServerPluginActivationContext } from "@chainingintention/pi-web-cn/server-plugin-api";
import type { Review } from "./browser/protocol.js";
import { collectReview } from "./reviewRun.js";
import { ReviewStore, reviewScope } from "./store.js";

const plugin = {
  apiVersion: 3,
  name: "工作区审查",
  requires: [PI_WEB_HOST_PI_SESSIONS_CAPABILITY, PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY],
  activate(host: ServerPluginActivationContext) {
    const store = new ReviewStore(host.dataDirectory);
    const active = new Map<string, Review>();
    const tasks = new Set<Promise<void>>();
    // Retain failed writes in memory so a refresh cannot present stale running/success state.
    const unsaved = new Map<string, Review>();
    let piSessions: PiWebHostPiSessionsV1;
    let sessionEvents: PiWebHostPiSessionEventsV1;
    const visible = (scope: string, record: Review): Review => {
      const failed = unsaved.get(record.id);
      if (failed) return failed;
      return record.status === "running" && active.get(scope)?.id !== record.id
        ? { ...record, status: "interrupted", text: "后端在记录完成结果前停止。请检查对话，再手动发起新审查。" }
        : record;
    };
    return {
      start({ capabilities }) {
        piSessions = capabilities.resolve(PI_WEB_HOST_PI_SESSIONS_CAPABILITY);
        sessionEvents = capabilities.resolve(PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY);
      },
      peer: {
        async request(context) {
          context.signal.throwIfAborted();
          host.lifetimeSignal.throwIfAborted();
          const selection = { projectId: context.project.id, workspaceId: context.workspace.id };
          const scope = reviewScope(selection.projectId, selection.workspaceId);
          if (context.operation === "list") {
            return (await store.list(scope)).map((record) => {
              const review = visible(scope, record);
              return { ...review, text: "" };
            });
          }
          if (context.operation === "read") return { ...visible(scope, await store.read(scope, context.input)) };
          if (context.operation !== "start") throw new Error("未知的审查操作");
          if (active.has(scope)) throw new Error("此工作区已有审查运行中，请刷新状态");
          const record: Review = { id: randomUUID(), createdAt: new Date().toISOString(), sessionId: "", status: "running", text: "正在启动审查会话…" };
          active.set(scope, record);
          try {
            // Persist before starting work. Browser cancellation after admission does not own the run.
            await store.save(scope, record);
          } catch (error) { active.delete(scope); throw error; }
          const task = (async () => {
            try {
              host.lifetimeSignal.throwIfAborted();
              ({ sessionId: record.sessionId } = await piSessions.create(selection));
              record.text = "审查进行中。刷新查看保存的结果，可在会话中打开对话。";
              await store.save(scope, record);
              host.lifetimeSignal.throwIfAborted();
              const connection = await sessionEvents.connect({ ...selection, sessionId: record.sessionId });
              try { record.text = await collectReview(connection, record.id, host.lifetimeSignal); }
              finally { connection.close(); }
              record.status = "completed";
            } catch (error) {
              record.status = "failed";
              record.text = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
            }
            try { await store.save(scope, record); }
            catch (error) {
              record.status = "failed";
              record.text = `无法保存审查：${error instanceof Error ? error.message : String(error)}。请检查会话 ${record.sessionId}.`.slice(0, 4000);
              unsaved.set(record.id, { ...record });
              host.logger.error(record.text);
            } finally { active.delete(scope); }
          })();
          tasks.add(task);
          void task.finally(() => { tasks.delete(task); });
          return { ...record };
        },
      },
      async dispose() { await Promise.all(tasks); active.clear(); unsaved.clear(); },
    };
  },
} satisfies PiWebServerPlugin;
export default plugin;
