import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionsApi } from "./clients";
import { setApiScope } from "./http";
import { sessionEvents } from "./sockets";

const session = { id: "s /?", cwd: "/repo with spaces" };
const image = { type: "image", mediaId: "a".repeat(64), mimeType: "image/png", byteSize: 3 };
const page = { messages: [{ role: "user", content: [image, { type: "image", mimeType: "image/png", data: "QUJD" }] }], start: 5, total: 15, leafId: "leaf" };
const status = { sessionId: session.id, isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };

beforeEach(() => {
  setApiScope("normal");
  vi.stubEnv("BASE_URL", "./");
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-web/" });
});

afterEach(() => {
  setApiScope("normal");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("opts history, atomic snapshots and join snapshots into references without discarding legacy payloads or leaf", async () => {
  const stream = { seq: 12, partial: { role: "assistant", content: [image] } };
  const payloads = [page, { page, status, ...stream }, stream];
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(JSON.stringify(payloads.shift()), { headers: { "content-type": "application/json" } })));
  vi.stubGlobal("fetch", fetch);
  expect(await sessionsApi.messages(session, { limit: 10, before: 15 }, "remote /?")).toEqual(page);
  expect(await sessionsApi.transcriptSnapshot(session, { limit: 25 }, "remote /?")).toMatchObject({ page, seq: 12 });
  expect(await sessionsApi.streamSnapshot(session, "remote /?")).toEqual(stream);
  expect(fetch.mock.calls.map(([url]) => typeof url === "string" ? url : url instanceof URL ? url.href : url.url)).toEqual([
    "https://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/sessions/s%20%2F%3F/messages?cwd=%2Frepo+with+spaces&limit=10&before=15&media=reference",
    "https://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/sessions/s%20%2F%3F/transcript-snapshot?cwd=%2Frepo+with+spaces&limit=25&media=reference",
    "https://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/sessions/s%20%2F%3F/stream-snapshot?cwd=%2Frepo+with+spaces&media=reference",
  ]);
});

it("keeps explicit socket scope and legacy string compatibility while opting scoped sockets into references", () => {
  const urls: string[] = [];
  vi.stubGlobal("WebSocket", function Socket(url: string) { urls.push(url); });
  vi.stubGlobal("location", { href: "https://pi.example.test/nested/pi-web/?embed=management&token=launch-token" });
  sessionEvents(session, "remote /?", "normal");
  sessionEvents(session, "remote /?", "management");
  sessionEvents("legacy /?", "remote /?", "normal");
  const scoped = "wss://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/sessions/s%20%2F%3F/events?cwd=%2Frepo+with+spaces&media=reference";
  expect(urls).toEqual([scoped, `${scoped}&embed=management&token=launch-token`, "wss://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/sessions/legacy%20%2F%3F/events"]);
});
