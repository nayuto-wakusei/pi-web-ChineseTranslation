// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoreMessageActions } from "../plugins/core/messageActions";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(entryId: string | undefined = "entry-1") {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messageActionContext = { machine: { id: "local", name: "Local", kind: "local" }, session: { id: "session-1", cwd: "/repo", archived: false, pending: false, busy: false } };
  view.messageActions = createCoreMessageActions().map((action) => ({ ...action, id: "core:" + action.id, binding: { registrationPluginId: "core", sourcePluginId: "core" } }));
  view.messages = [{ role: "user", entryId, parts: [{ type: "text", text: "Hello" }] }];
  view.onMessageAction = vi.fn(() => Promise.resolve());
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function button(view: ChatView, index: number): HTMLButtonElement {
  const result = buttons(view)[index];
  if (result === undefined) throw new Error(`Missing message action ${String(index)}`);
  return result;
}

function buttons(view: ChatView) {
  return Array.from(view.renderRoot.querySelectorAll<HTMLButtonElement>(".msg-action"));
}

describe("chat message history shortcuts", () => {
  it.each(["machine", "workspace", "session ABA", "disconnect"] as const)("ignores a late history failure after %s changes", async (change) => {
    const view = await mount();
    view.workspaceContext = { machineId: "local", projectId: "p", workspaceId: "w", root: "/first" };
    await view.updateComplete;
    let rejectAction!: (error: Error) => void;
    view.onMessageAction = () => new Promise<void>((_resolve, reject) => { rejectAction = reject; });
    vi.stubGlobal("confirm", () => true);
    button(view, 0).click();
    await view.updateComplete;
    if (change === "machine") view.machineId = "remote";
    else if (change === "workspace") view.workspaceContext = { ...view.workspaceContext, root: "/second" };
    else if (change === "session ABA") {
      view.sessionId = "session-2";
      await view.updateComplete;
      view.sessionId = "session-1";
    } else {
      view.remove();
      document.body.append(view);
    }
    await view.updateComplete;
    rejectAction(new Error("Previous identity failed"));
    await Promise.resolve();
    await view.updateComplete;
    expect(view.renderRoot.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not let an old history completion clear a new identity's pending action", async () => {
    const view = await mount();
    let rejectOld!: (error: Error) => void;
    let finishNew!: () => void;
    const action = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishNew = resolve; }));
    view.onMessageAction = action;
    vi.stubGlobal("confirm", () => true);
    button(view, 0).click();
    await view.updateComplete;
    view.machineId = "remote";
    await view.updateComplete;
    expect(button(view, 0).disabled).toBe(false);
    button(view, 1).click();
    await view.updateComplete;
    expect(action).toHaveBeenCalledTimes(2);
    rejectOld(new Error("Old action failed"));
    await Promise.resolve();
    await view.updateComplete;
    expect(button(view, 0).disabled).toBe(true);
    expect(view.renderRoot.querySelector('[role="alert"]')).toBeNull();
    finishNew();
    await Promise.resolve();
    await view.updateComplete;
    expect(button(view, 0).disabled).toBe(false);
  });
});
