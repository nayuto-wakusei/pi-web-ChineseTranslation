import { localization } from "../localization/browser";
import { t } from "../i18n";
import { thinkingLevelDisplayLabel } from "../../../shared/thinkingLevels";
import { describe, expect, it } from "vitest";
import type { QueuedSessionMessage, SessionStatus, SessionWarning } from "../api";
import {
  chatEventAnchorKey,
  chatGroupAnchorKey,
  chatMessageAnchorKey,
  chatMessageMetadataLabel,
  chatQueuedMessageSections,
  chatQueuedSectionShowsClearAction,
} from "./ChatView";
import { chatSessionWarningRows } from "./chat/SessionWarnings";
import type { ChatLine } from "./shared";

describe("chatQueuedMessageSections", () => {
  it("keeps client pending-start sends separate from server queued messages", () => {
    const sections = chatQueuedMessageSections(
      [{ kind: "followUp", text: "queued before start" }],
      [{ kind: "steer", text: "server queued" }],
    );

    expect(sections.map(({ source, messages }) => ({ source, messages }))).toEqual([
      { source: "client", messages: [{ kind: "followUp", text: "queued before start" }] },
      { source: "server", messages: [{ kind: "steer", text: "server queued" }] },
    ]);
  });
});

describe("chatQueuedSectionShowsClearAction", () => {
  // The show/hide decision for the server clear-queue button is content/layout,
  // so it lives in a pure exported seam instead of scraping rendered markup.
  const serverSection = requireSection(chatQueuedMessageSections([], [{ kind: "steer", text: "server queued" }])[0]);
  const clientSection = requireSection(chatQueuedMessageSections([{ kind: "followUp", text: "waiting" }], [])[0]);

  it("shows the action for the server queue when a clear handler is wired", () => {
    expect(chatQueuedSectionShowsClearAction(serverSection, true, true)).toBe(true);
  });

  it("hides the action when no clear handler is wired", () => {
    expect(chatQueuedSectionShowsClearAction(serverSection, true, false)).toBe(false);
  });

  it("never shows the server action for the separate client pending-start queue", () => {
    expect(chatQueuedSectionShowsClearAction(clientSection, true, true)).toBe(false);
  });
});

describe("chatSessionWarningRows", () => {
  // Test warning-row shaping directly rather than depending on template markup.
  it("preserves each diagnostic's severity, message and optional provenance", () => {
    const rows = chatSessionWarningRows(warningStatus([
      { severity: "error", message: "skill failed to load", source: "skill", path: "/skills/a.md" },
      { severity: "warning", message: "subscription auth is active" },
      { severity: "info", message: "heads up", source: "runtime" },
    ]));

    expect(rows.map(({ severity, message, source, path }) => ({ severity, message, source, path }))).toEqual([
      { severity: "error", message: "skill failed to load", source: "skill", path: "/skills/a.md" },
      { severity: "warning", message: "subscription auth is active", source: undefined, path: undefined },
      { severity: "info", message: "heads up", source: "runtime", path: undefined },
    ]);
  });

  it("exposes a dismiss id only for warnings carrying a dismiss capability", () => {
    const rows = chatSessionWarningRows(warningStatus([
      { severity: "error", message: "skill failed to load", source: "skill" },
      { severity: "warning", message: "subscription auth is active", source: "anthropic", dismiss: { id: "anthropicExtraUsage" } },
    ]));

    expect(rows.map((row) => row.dismissId)).toEqual([undefined, "anthropicExtraUsage"]);
  });

  it("derives no rows when there are no warnings or status is unset", () => {
    expect(chatSessionWarningRows(warningStatus([]))).toEqual([]);
    expect(chatSessionWarningRows(undefined)).toEqual([]);
  });
});

describe("chatMessageMetadataLabel", () => {
  it("uses one full date and model label without a model prefix", () => {
    const timestamp = "2026-07-10T19:15:30.000Z";
    const formattedTimestamp = localization.date(new Date(timestamp), { dateStyle: "medium", timeStyle: "medium" });

    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "model" } },
    })).toBe(localization.list([formattedTimestamp, "provider/model"]));
  });

  it("appends the thinking level after the model when present", () => {
    const timestamp = "2026-07-10T19:15:30.000Z";
    const formattedTimestamp = localization.date(new Date(timestamp), { dateStyle: "medium", timeStyle: "medium" });

    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "model" }, thinkingLevel: "high" },
    })).toBe(localization.list([formattedTimestamp, "provider/model", thinkingLevelDisplayLabel("high", t)]));
  });
});

describe("chat event-group content seams", () => {
  // Content/structure decisions have pure seams; native disclosure behavior is
  // covered through the DOM in ChatView.behaviors.test.ts.
  it("never derives scroll-anchor keys from display indexes or empty entry IDs", () => {
    for (const key of [chatMessageAnchorKey, chatEventAnchorKey, chatGroupAnchorKey]) {
      expect(key(40)).toBeUndefined();
      expect(key(41, { role: "assistant", parts: [] })).toBeUndefined();
      expect(key(42, { entryId: "", role: "assistant", parts: [] })).toBeUndefined();
    }
  });
it("keeps durable entry keys independent of normalized indexes and separates entry slices", () => {
    const reply: ChatLine = { entryId: "entry-1", role: "user", parts: [{ type: "text", text: "Question" }] };
    const invocation: ChatLine = { ...reply, parts: [{ type: "skillInvocation", name: "testing", location: "SKILL.md", content: "Instructions" }] };
    for (const key of [chatMessageAnchorKey, chatEventAnchorKey, chatGroupAnchorKey]) {
      expect(key(495, reply)).toBe(key(453, reply));
      expect(key(495, reply)).not.toBe(key(495, invocation));
      expect(key(495, reply)).not.toBe(key(495, { ...reply, entryId: "entry-2" }));
    }
    expect(chatMessageAnchorKey(495, reply)).not.toBe(chatEventAnchorKey(495, reply));
  });
});

function requireSection(section: ReturnType<typeof chatQueuedMessageSections>[number] | undefined): ReturnType<typeof chatQueuedMessageSections>[number] {
  if (section === undefined) throw new Error("expected a queued-message section");
  return section;
}

function warningStatus(warnings: SessionWarning[]): SessionStatus {
  return {
    ...queuedStatus([]),
    ...(warnings.length === 0 ? {} : { warnings }),
  };
}

function queuedStatus(queuedMessages: QueuedSessionMessage[]): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: queuedMessages.length,
    queuedMessages,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}
