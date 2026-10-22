import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalSessionEvents, realtimeEvents, sessionEvents } from "./sockets";

const webSocketUrls: string[] = [];

function FakeWebSocket(url: string): void {
  webSocketUrls.push(url);
}

beforeEach(() => {
  webSocketUrls.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("machine-scoped socket urls", () => {
  it("defaults session sockets to the local machine scope", () => {
    sessionEvents({ id: "s1", cwd: "/repo" });
    globalSessionEvents();
    realtimeEvents();

    expect(webSocketUrls).toEqual([
      "wss://pi.example.test/api/machines/local/sessions/s1/events?cwd=%2Frepo&media=reference",
      "wss://pi.example.test/api/machines/local/sessions/events",
      "wss://pi.example.test/api/machines/local/events",
    ]);
  });

  it("keeps legacy session socket urls usable without cwd", () => {
    sessionEvents("s1");

    expect(webSocketUrls).toEqual([
      "wss://pi.example.test/api/machines/local/sessions/s1/events",
    ]);
  });

  it("uses and encodes the requested machine and session scope", () => {
    sessionEvents({ id: "s?1", cwd: "/repo" }, "remote / a");

    expect(webSocketUrls).toEqual([
      "wss://pi.example.test/api/machines/remote%20%2F%20a/sessions/s%3F1/events?cwd=%2Frepo&media=reference",
    ]);
  });

  it("adds management embed parameters to session and realtime sockets in management scope", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "pi.example.test", href: "https://pi.example.test/?embed=management&token=launch-token" });

    sessionEvents({ id: "s1", cwd: "/repo" }, "local", "management");
    globalSessionEvents("local", "management");
    realtimeEvents("local", "management");

    expect(webSocketUrls).toEqual([
      "wss://pi.example.test/api/machines/local/sessions/s1/events?cwd=%2Frepo&media=reference&embed=management&token=launch-token",
      "wss://pi.example.test/api/machines/local/sessions/events?embed=management&token=launch-token",
      "wss://pi.example.test/api/machines/local/events?embed=management&token=launch-token",
    ]);
  });

  it("does not add management embed parameters to normal-scope sockets on a management page", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "pi.example.test", href: "https://pi.example.test/?embed=management&token=launch-token" });

    sessionEvents({ id: "s1", cwd: "/repo" }, "local", "normal");
    realtimeEvents("local", "normal");

    expect(webSocketUrls).toEqual([
      "wss://pi.example.test/api/machines/local/sessions/s1/events?cwd=%2Frepo&media=reference",
      "wss://pi.example.test/api/machines/local/events",
    ]);
  });

  it("keeps management websocket routing when the session cookie replaces the entry token", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "pi.example.test", href: "https://pi.example.test/?embed=management" });

    sessionEvents({ id: "s1", cwd: "/repo" }, "local", "management");
    realtimeEvents("local", "management");

    expect(webSocketUrls).toEqual([
      "wss://pi.example.test/api/machines/local/sessions/s1/events?cwd=%2Frepo&media=reference&embed=management",
      "wss://pi.example.test/api/machines/local/events?embed=management",
    ]);
  });
});
