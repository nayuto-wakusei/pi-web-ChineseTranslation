import { expect, it, vi } from "vitest";
import type { EntryMessageActionContribution, MessageActionAvailabilityContext, MessageActionContribution } from "../../../plugin-api";
import type { ChatLine } from "../components/shared";
import { MessageActionAvailabilityCache, type RegisteredMessageAction } from "./messageActions";

const input: MessageActionAvailabilityContext = { machine: { id: "remote", name: "Remote", kind: "remote" }, session: { id: "s", cwd: "/repo", archived: false, pending: false, busy: false }, message: { entryId: "entry", role: "user", text: "Hello" } };
function registered(action: MessageActionContribution): RegisteredMessageAction { return { ...action, binding: { registrationPluginId: "runtime", sourcePluginId: "source" } }; }

  it("gates default/explicit entry predicates by canonical status and caches that status independently", () => {
    const entryVisible = vi.fn<NonNullable<EntryMessageActionContribution["visible"]>>(() => true);
    const entryEnabled = vi.fn<NonNullable<EntryMessageActionContribution["enabled"]>>(() => false);
    const entryLabel = vi.fn<NonNullable<EntryMessageActionContribution["ariaLabel"]>>(() => "Entry label");
    const displayVisible = vi.fn(() => true);
    const displayEnabled = vi.fn(() => false);
    const displayLabel = vi.fn(() => "Display label");
    const actions = [
      registered({ id: "default", title: "Default entry", visible: entryVisible, enabled: entryEnabled, ariaLabel: entryLabel, run: () => undefined }),
      registered({ target: "display", id: "display", title: "Display", visible: displayVisible, enabled: displayEnabled, ariaLabel: displayLabel, run: () => undefined }),
      registered({ target: "entry", id: "explicit", title: "Explicit entry", visible: entryVisible, enabled: entryEnabled, ariaLabel: entryLabel, run: () => undefined }),
    ];
    const source: ChatLine = { entryId: "shared", role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "text", text: "reply" }] };
    const slice: ChatLine = { ...source, parts: [{ type: "text", text: "reply" }] };
    const base = { machine: input.machine, session: input.session };
    const cache = new MessageActionAvailabilityCache();
    const noncanonical = cache.get(source, actions, base, slice, false);

    expect(noncanonical).toEqual([{ action: actions[1], enabled: false, ariaLabel: "Display label" }]);
    for (const predicate of [entryVisible, entryEnabled, entryLabel]) expect(predicate).not.toHaveBeenCalled();
    for (const predicate of [displayVisible, displayEnabled, displayLabel]) {
      expect(predicate).toHaveBeenCalledExactlyOnceWith({ ...base, message: { entryId: "shared", role: "assistant", text: "reply" } });
    }
    const canonical = cache.get(source, actions, base, slice, true);
    expect(canonical).toEqual([
      { action: actions[0], enabled: false, ariaLabel: "Entry label" },
      noncanonical[0],
      { action: actions[2], enabled: false, ariaLabel: "Entry label" },
    ]);
    expect(cache.get(source, actions, base, { ...slice })).toBe(canonical);
    expect(cache.get(source, actions, base, { ...slice }, false)).toBe(noncanonical);
    for (const predicate of [entryVisible, entryEnabled, entryLabel]) expect(predicate).toHaveBeenCalledTimes(2);
    for (const predicate of [displayVisible, displayEnabled, displayLabel]) expect(predicate).toHaveBeenCalledTimes(2);
  });
