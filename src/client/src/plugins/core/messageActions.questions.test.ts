import { describe, expect, it } from "vitest";
import type { MessageActionAvailabilityContext } from "../../../../plugin-api";
import { availableMessageActions } from "../messageActions";
import { createCoreMessageActions } from "./messageActions";
const input: MessageActionAvailabilityContext = {
  machine: { id: "local", name: "Local", kind: "local" },
  session: { id: "session", cwd: "/repo", archived: false, pending: false, busy: false },
  message: { entryId: "entry", role: "assistant", text: "Original text" },
};

describe("core question history actions", () => {
  it.each([
    { flags: {}, enabled: true },
    { flags: { busy: true }, enabled: false },
    { flags: { archived: true }, enabled: false },
    { flags: { pending: true }, enabled: false },
  ])("uses the existing history policy for questions ($flags)", ({ flags, enabled }) => {
    const actions = createCoreMessageActions().map((action) => ({
      ...action, binding: { registrationPluginId: "core", sourcePluginId: "core" },
    }));
    const session = { ...input.session, ...flags };
    expect(availableMessageActions(actions, {
      ...input, session, message: { entryId: "question-result", role: "tool", text: "", isQuestion: true },
    }).map(({ action, enabled }) => ({ id: action.id, enabled }))).toEqual([
      { id: "message.fork", enabled }, { id: "message.back", enabled },
    ]);
    expect(availableMessageActions(actions, {
      ...input, session, message: { entryId: "ordinary-tool-result", role: "tool", text: "Tool output" },
    })).toEqual([]);
  });
});
