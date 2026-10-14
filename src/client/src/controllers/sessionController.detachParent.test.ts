import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { createSessionControllerTestFixture, deferred, oldSession, workspace } from "./sessionController.testSupport";

describe("SessionController detach parent", () => {
  it("does not replace a same-id session on another machine after detaching", async () => {
    const child = { ...oldSession, parentSessionPath: "/repo/parent.jsonl" };
    const detached = deferred<{ detached: true }>();
    const detachParent = vi.fn(() => detached.promise);
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, selectedSession: child, sessions: [child] },
      api: { detachParent },
    });
    try {
      const pending = fixture.controller.detachParent();
      const remoteChild = { ...child, name: "Remote child" };
      fixture.replaceState({
        ...fixture.state,
        selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" },
        selectedSession: remoteChild,
        sessions: [remoteChild],
      });
      detached.resolve({ detached: true });
      await pending;

      expect(detachParent).toHaveBeenCalledWith(child, "local");
      expect(fixture.state.selectedSession).toBe(remoteChild);
      expect(fixture.state.sessions).toEqual([remoteChild]);
    } finally {
      fixture.controller.dispose();
    }
  });

  it("removes only the parent link and preserves metadata refreshed during the request", async () => {
    const child = { ...oldSession, parentSessionPath: "/repo/parent.jsonl" };
    const detached = deferred<{ detached: true }>();
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, selectedSession: child, sessions: [child] },
      api: { detachParent: () => detached.promise },
    });
    try {
      const pending = fixture.controller.detachParent();
      const updated = { ...child, name: "Renamed child", messageCount: 5 };
      fixture.replaceState({ ...fixture.state, selectedSession: updated, sessions: [updated] });
      detached.resolve({ detached: true });
      await pending;

      const expected = { ...oldSession, name: "Renamed child", messageCount: 5 };
      expect(fixture.state.selectedSession).toEqual(expected);
      expect(fixture.state.sessions).toEqual([expected]);
    } finally {
      fixture.controller.dispose();
    }
  });

  it("updates a background row without changing the selected conversation", async () => {
    const child = { ...oldSession, parentSessionPath: "/repo/parent.jsonl" };
    const selected = { ...oldSession, id: "other-session" };
    const fixture = createSessionControllerTestFixture({
      initialState: { ...initialAppState(), selectedWorkspace: workspace, selectedSession: selected, sessions: [child, selected] },
      api: { detachParent: () => Promise.resolve({ detached: true }) },
    });
    try {
      await fixture.controller.detachParent(child);
      expect(fixture.state.sessions).toEqual([oldSession, selected]);
      expect(fixture.state.selectedSession).toBe(selected);
    } finally {
      fixture.controller.dispose();
    }
  });
});
