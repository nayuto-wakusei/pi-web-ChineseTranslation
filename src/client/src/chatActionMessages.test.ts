import { afterEach, expect, it } from "vitest";
import { localization } from "./localization/browser";
import { chatActionMessages, HistoryActionError } from "./chatActionMessages";
import { queuedMessageRecallConfirmation } from "./queuedMessageActions";
import type { QueuedSessionMessage } from "./api";

const removers: (() => void)[] = [];
afterEach(async () => {
  for (const remove of removers.splice(0)) remove();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

it.each([0, 1, 2].flatMap((steers) => [0, 1, 2].map((followUps) => ({ steers, followUps }))))(
  "retains every queue consequence for $steers steers and $followUps follow-ups",
  ({ steers, followUps }) => {
    const queue: QueuedSessionMessage[] = [
      { kind: "followUp", text: "original", hasAttachments: true },
      ...Array.from({ length: steers }, () => ({ kind: "steer" as const, text: "steer" })),
      ...Array.from({ length: followUps }, () => ({ kind: "followUp" as const, text: "follow-up" })),
    ];
    const parts = [
      steers === 0 ? undefined : `${String(steers)} later ${steers === 1 ? "steer" : "steers"}`,
      followUps === 0 ? undefined : `${String(followUps)} queued ${followUps === 1 ? "follow-up" : "follow-ups"}`,
    ].filter((part) => part !== undefined);
    expect(queuedMessageRecallConfirmation(queue, 0)).toBe(
      "Recall this message? Only its text will return to the composer. Its attachments will be lost."
      + (parts.length === 0 ? "" : `\n\nThis will also remove ${parts.join(" and ")}.`),
    );
    queue[0] = { kind: "followUp", text: "original" };
    expect(queuedMessageRecallConfirmation(queue, 0)).toBe(parts.length === 0 ? undefined
      : `Recall this message?\n\nThis will also remove ${parts.join(" and ")}.`);
  },
);

it("formats consequences regionally and supports a translator's complete reordered confirmation", async () => {
  const queue: QueuedSessionMessage[] = [{ kind: "steer", text: "RAW <hello>" },
    ...Array.from({ length: 1000 }, () => ({ kind: "followUp" as const, text: "raw" }))];
  await localization.setPreferences({ language: "en", formatLocale: "de-DE" });
  expect(queuedMessageRecallConfirmation(queue, 0)).toContain("1.000 queued follow-ups");
  removers.push(localization.registerCatalog({ id: "chat-actions-test", namespace: "core.chatActions", locale: "de", load: () => Promise.resolve({
    recall: "{steers, number} Steuersignale, {followUps, number} Folgenachrichten entfernen? {attachments, select, yes {Anhänge gehen verloren.} other {Nur Text.}}",
  }) }));
  await localization.setPreferences({ language: "de", formatLocale: "de-DE" });
  expect(queuedMessageRecallConfirmation(queue, 0)).toBe("0 Steuersignale, 1.000 Folgenachrichten entfernen? Nur Text.");
  expect(queue[0]?.text).toBe("RAW <hello>");
});

it("keeps existing history errors live through translated and pseudo locales", async () => {
  const error = new HistoryActionError("messageUnavailable");
  expect(error.message).toBe("This message is no longer available in session history.");
  removers.push(localization.registerCatalog({ id: "history-errors-test", namespace: "core.chatActions", locale: "de", load: () => Promise.resolve({ messageUnavailable: "Nachricht nicht mehr verfügbar." }) }));
  await localization.setPreferences({ language: "de", formatLocale: "de" });
  expect(error.message).toBe("Nachricht nicht mehr verfügbar.");
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    expect(error.message).toBe(chatActionMessages.t("messageUnavailable"));
    expect(error.message).not.toBe("This message is no longer available in session history.");
  }
});
