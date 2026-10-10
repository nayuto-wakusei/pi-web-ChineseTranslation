import type { PiWebHostPiSessionConnection } from "@chainingintention/pi-web-cn/server-plugin-api";
import { MAX_FINDINGS, REVIEW_REPLY, REVIEW_REQUEST } from "./browser/protocol.js";

/** Receipt and completion are separate, correlated events. Neither close nor timeout cancels Pi. */
export async function collectReview(connection: PiWebHostPiSessionConnection, requestId: string, lifetime: AbortSignal): Promise<string> {
  const signal = AbortSignal.any([lifetime, connection.signal]);
  signal.throwIfAborted();
  let unsubscribe: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  let receiptTimer: ReturnType<typeof setTimeout> | undefined;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      onAbort = () => { reject(new Error("审查连接已中断，代理可能仍在会话中运行")); };
      signal.addEventListener("abort", onAbort, { once: true });
      receiptTimer = setTimeout(() => { reject(new Error("5 秒内未收到伴随扩展回执。请检查包启用状态和项目信任，重试前先检查会话。")); }, 5_000);
      completionTimer = setTimeout(() => { reject(new Error("审查超过 10 分钟，代理可能仍在会话中运行，未保存审查结果。")); }, 600_000);
      unsubscribe = connection.on(REVIEW_REPLY, (data) => {
        if (typeof data !== "object" || data === null || !("requestId" in data) || data.requestId !== requestId) return;
        if (!("status" in data)) return;
        if (data.status === "accepted") { clearTimeout(receiptTimer); return; }
        if (data.status === "failed") {
          reject(new Error("error" in data && typeof data.error === "string" ? data.error.slice(0, 4000) : "审查失败"));
        } else if (data.status === "completed") {
          if (!("text" in data) || typeof data.text !== "string" || !data.text.trim() || data.text.length > MAX_FINDINGS) {
            reject(new Error("伴随扩展返回的审查结果无效"));
          } else resolve(data.text);
        }
      });
      // Native listeners can reply synchronously.
      connection.emit(REVIEW_REQUEST, { requestId });
    });
  } finally {
    clearTimeout(receiptTimer);
    clearTimeout(completionTimer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    unsubscribe?.();
  }
}
