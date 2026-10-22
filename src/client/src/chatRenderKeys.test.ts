import { expect, it } from "vitest";
import { ChatRenderKeys } from "./chatRenderKeys";

it("retains a live message through a prepend and durable finalization by stream identity", () => {
  const keys = new ChatRenderKeys();
  const first = keys.reconcile("machine-a/session", [{ slot: "reply:10", streamIdentity: "stream:reply" }]);
  const prepended = keys.reconcile("machine-a/session", [{ slot: "earlier", identity: "earlier" }, { slot: "reply:11", streamIdentity: "stream:reply" }]);
  expect(prepended[1]).toBe(first[0]);
  const final = keys.reconcile("machine-a/session", [{ slot: "earlier", identity: "earlier" }, { slot: "reply:11", streamIdentity: "stream:reply", identity: "durable:reply" }]);
  expect(final[1]).toBe(first[0]);
  expect(keys.reconcile("machine-a/session", [{ slot: "reply:12", identity: "durable:reply" }])[0]).toBe(first[0]);
});

it("does not reuse elements belonging to a different machine transcript", () => {
  const keys = new ChatRenderKeys();
  keys.reconcile("machine-a/session", [{ slot: "first", identity: "old" }]);
  keys.reconcile("machine-a/session", [{ slot: "second", identity: "entry" }]);
  expect(keys.reconcile("machine-b/session", [{ slot: "second", identity: "entry" }])).toEqual(["render:0"]);
});
