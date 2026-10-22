import { expect, it } from "vitest";
import { loadCachedNewSessions, rememberCachedNewSession, stripCachedNewSessionMarker } from "./cachedNewSessions";

it("keeps tracked provenance through a cached new session round trip without mixing machines", () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
  const session = {
    id: "same-id", path: "/sessions/child.jsonl", cwd: "/workspace",
    created: "2026-01-01", modified: "2026-01-01", messageCount: 0, firstMessage: "",
    agentSubsession: true,
  };
  rememberCachedNewSession(session, "machine-a", storage);
  rememberCachedNewSession({ ...session, agentSubsession: false }, "machine-b", storage);
  const cached = loadCachedNewSessions(storage);
  const a = cached.find((value) => value.machineId === "machine-a");
  const b = cached.find((value) => value.machineId === "machine-b");
  expect(a).toMatchObject({ agentSubsession: true });
  expect(b).not.toHaveProperty("agentSubsession");
  expect(a && stripCachedNewSessionMarker(a)).toMatchObject({ agentSubsession: true });
});
