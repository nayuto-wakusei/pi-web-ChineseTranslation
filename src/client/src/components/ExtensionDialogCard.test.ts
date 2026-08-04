// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingExtensionDialog } from "../../../shared/apiTypes";
import type { ClosedExtensionDialog } from "../appState";
import {
  ExtensionDialogCard,
  extensionDialogCloseLabel,
  extensionDialogCloseSummary,
  extensionDialogCountdownText,
  type ExtensionDialogAnswerCallback,
  type ExtensionDialogCancelCallback,
  type ExtensionDialogDismissCallback,
} from "./ExtensionDialogCard";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("extension-dialog-card confirm dialog", () => {
  it("renders the title and message and answers Yes/No or cancels through the rendered buttons", async () => {
    const onAnswer = vi.fn<ExtensionDialogAnswerCallback>();
    const onCancel = vi.fn<ExtensionDialogCancelCallback>();
    const card = await mountOpenDialog(openDialog({ message: "The extension wants to write files." }), { onAnswer, onCancel });
    const root = renderRoot(card);

    expect(root.querySelector("h2")?.textContent).toBe("Allow file writes?");
    expect(root.querySelector(".dialog-message")?.textContent).toBe("The extension wants to write files.");
    expect(root.querySelector("input, select, textarea")).toBeNull();

    buttonWithText(root, "是").click();
    await flushClose(card);
    expect(onAnswer).toHaveBeenCalledWith("dlg-1", true);

    buttonWithText(root, "否").click();
    await flushClose(card);
    expect(onAnswer).toHaveBeenCalledWith("dlg-1", false);

    buttonWithText(root, "取消").click();
    await flushClose(card);
    expect(onCancel).toHaveBeenCalledWith("dlg-1");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables the answer controls while a close is in flight", async () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn<ExtensionDialogAnswerCallback>(() => new Promise<void>((resolve) => { resolveAnswer = resolve; }));
    const card = await mountOpenDialog(openDialog(), { onAnswer });
    const root = renderRoot(card);

    const yes = buttonWithText(root, "是");
    yes.click();
    await card.updateComplete;

    expect(yes.disabled).toBe(true);
    expect(buttonWithText(root, "否").disabled).toBe(true);
    expect(buttonWithText(root, "取消").disabled).toBe(true);

    resolveAnswer?.();
    await flushClose(card);
    expect(yes.disabled).toBe(false);
    expect(onAnswer).toHaveBeenCalledOnce();
  });
});

describe("extension-dialog-card select dialog", () => {
  it("answers with the clicked option", async () => {
    const onAnswer = vi.fn<ExtensionDialogAnswerCallback>();
    const card = await mountOpenDialog(openDialog({
      kind: "select",
      title: "Deploy where?",
      options: ["Staging", "Production"],
    }), { onAnswer });
    const root = renderRoot(card);

    expect(buttonsWithText(root, "是")).toHaveLength(0);
    buttonWithText(root, "Production").click();
    await Promise.resolve();

    expect(onAnswer).toHaveBeenCalledWith("dlg-1", "Production");
    expect(onAnswer).toHaveBeenCalledOnce();
  });
});

describe("extension-dialog-card input dialog", () => {
  it("sends the typed text and keeps the placeholder and length bound", async () => {
    const onAnswer = vi.fn<ExtensionDialogAnswerCallback>();
    const card = await mountOpenDialog(openDialog({
      kind: "input",
      title: "Name the branch",
      placeholder: "feature/…",
    }), { onAnswer });
    const root = renderRoot(card);
    const input = requiredElement(root.querySelector("input"), "dialog input");

    expect(input.placeholder).toBe("feature/…");
    expect(input.maxLength).toBe(4000);

    input.value = "feature/dialogs";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await card.updateComplete;
    buttonWithText(root, "发送").click();
    await Promise.resolve();

    expect(onAnswer).toHaveBeenCalledWith("dlg-1", "feature/dialogs");
  });

  it("sends an empty string without typing", async () => {
    const onAnswer = vi.fn<ExtensionDialogAnswerCallback>();
    const card = await mountOpenDialog(openDialog({ kind: "input", title: "Notes?" }), { onAnswer });
    const root = renderRoot(card);

    const send = buttonWithText(root, "发送");
    expect(send.disabled).toBe(false);
    send.click();
    await Promise.resolve();

    expect(onAnswer).toHaveBeenCalledWith("dlg-1", "");
  });

  it("keeps a half-typed answer when the same dialog is re-projected from a status refresh", async () => {
    const card = await mountOpenDialog(openDialog({ kind: "input", title: "Notes?" }));
    const root = renderRoot(card);
    const input = requiredElement(root.querySelector("input"), "dialog input");
    input.value = "half typed";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await card.updateComplete;

    card.dialog = { ...openDialog({ kind: "input", title: "Notes?" }) };
    await card.updateComplete;

    expect(requiredElement(root.querySelector("input"), "dialog input").value).toBe("half typed");
  });
});

describe("extension-dialog-card countdown", () => {
  it("shows the remaining time and ticks down each second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
    const card = await mountOpenDialog(openDialog({ timeoutAt: "2026-07-27T10:01:30.000Z" }));
    const root = renderRoot(card);
    const countdown = requiredElement(root.querySelector(".countdown"), "countdown");

    expect(countdown.textContent).toBe("1 分 30 秒后自动取消");

    await vi.advanceTimersByTimeAsync(30_000);
    await card.updateComplete;
    expect(countdown.textContent).toBe("1 分 0 秒后自动取消");
  });

  it("is decorative: no live region announcing every second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
    const card = await mountOpenDialog(openDialog({ timeoutAt: "2026-07-27T10:01:30.000Z" }));
    const root = renderRoot(card);

    // A ticking live region would queue a screen-reader announcement per
    // second; the daemon-owned dialog.closed event is the real signal.
    expect(requiredElement(root.querySelector(".countdown"), "countdown").getAttribute("role")).toBeNull();
    expect(root.querySelector("[aria-live]")).toBeNull();
  });

  it("renders no countdown when the dialog waits forever", async () => {
    vi.useFakeTimers();
    const card = await mountOpenDialog(openDialog());
    const root = renderRoot(card);

    expect(root.querySelector(".countdown")).toBeNull();
  });

  it("stops ticking once the dialog closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
    const card = await mountOpenDialog(openDialog({ timeoutAt: "2026-07-27T10:01:30.000Z" }));
    card.outcome = closedDialog("timeout");
    await card.updateComplete;

    const before = renderRoot(card).textContent;
    await vi.advanceTimersByTimeAsync(5_000);
    await card.updateComplete;

    expect(renderRoot(card).textContent).toBe(before);
    expect(renderRoot(card).querySelector("[role='status']")).toBeNull();
  });
});

describe("extension-dialog-card closed outcome", () => {
  it("shows the given answer and dismisses through the dismiss control", async () => {
    const onDismiss = vi.fn<ExtensionDialogDismissCallback>();
    const card = new ExtensionDialogCard();
    card.outcome = closedDialog("answered", true);
    card.onDismiss = onDismiss;
    document.body.append(card);
    await card.updateComplete;
    const root = renderRoot(card);

    expect(root.querySelector(".header-status")?.textContent).toBe("已回答");
    expect(root.querySelector(".closed-summary")?.textContent).toBe("回答：是");
    expect(root.querySelector("input, select, textarea")).toBeNull();
    expect(buttonsWithText(root, "是")).toHaveLength(0);

    buttonWithText(root, "关闭").click();
    expect(onDismiss).toHaveBeenCalledWith("dlg-1");
  });

  it("shows the timeout outcome without an answer", async () => {
    const card = new ExtensionDialogCard();
    card.outcome = closedDialog("timeout");
    document.body.append(card);
    await card.updateComplete;
    const root = renderRoot(card);

    expect(root.querySelector(".header-status")?.textContent).toBe("已超时");
    expect(root.querySelector(".closed-summary")?.textContent).toContain("超时");
  });
});

describe("extensionDialogCountdownText", () => {
  const now = Date.parse("2026-07-27T10:00:00.000Z");

  it("is undefined without a deadline or with an unparseable one", () => {
    expect(extensionDialogCountdownText(undefined, now)).toBeUndefined();
    expect(extensionDialogCountdownText("not-a-date", now)).toBeUndefined();
  });

  it("formats seconds, minutes, and hours", () => {
    expect(extensionDialogCountdownText("2026-07-27T10:00:45.000Z", now)).toBe("45 秒后自动取消");
    expect(extensionDialogCountdownText("2026-07-27T10:05:00.000Z", now)).toBe("5 分 0 秒后自动取消");
    expect(extensionDialogCountdownText("2026-07-27T11:02:00.000Z", now)).toBe("1 小时 2 分钟后自动取消");
  });

  it("never rounds the minutes up to 60 near an hour boundary", () => {
    expect(extensionDialogCountdownText("2026-07-27T11:59:55.000Z", now)).toBe("1 小时 59 分钟后自动取消");
    expect(extensionDialogCountdownText("2026-07-27T12:59:40.000Z", now)).toBe("2 小时 59 分钟后自动取消");
  });

  it("stays display-only once the deadline has passed", () => {
    expect(extensionDialogCountdownText("2026-07-27T09:59:59.000Z", now)).toBe("即将自动取消");
  });
});

describe("extensionDialogCloseLabel and extensionDialogCloseSummary", () => {
  it("labels every close reason", () => {
    expect(extensionDialogCloseLabel("answered")).toBe("已回答");
    expect(extensionDialogCloseLabel("cancelled")).toBe("已取消");
    expect(extensionDialogCloseLabel("timeout")).toBe("已超时");
    expect(extensionDialogCloseLabel("aborted")).toBe("已中止");
    expect(extensionDialogCloseLabel("session-ended")).toBe("会话已结束");
  });

  it("summarizes answers by kind", () => {
    expect(extensionDialogCloseSummary(closedDialog("answered", false))).toBe("回答：否");
    expect(extensionDialogCloseSummary(closedDialog("answered", "Staging"))).toBe("回答：Staging");
    expect(extensionDialogCloseSummary(closedDialog("answered", ""))).toBe("回答为空。");
  });

  it("summarizes closes without an answer", () => {
    expect(extensionDialogCloseSummary(closedDialog("cancelled"))).toBe("已取消，未回答。");
    expect(extensionDialogCloseSummary(closedDialog("timeout"))).toContain("超时");
    expect(extensionDialogCloseSummary(closedDialog("aborted"))).toContain("运行");
    expect(extensionDialogCloseSummary(closedDialog("session-ended"))).toContain("会话");
  });
});

async function mountOpenDialog(
  dialog: PendingExtensionDialog,
  callbacks: { onAnswer?: ExtensionDialogAnswerCallback; onCancel?: ExtensionDialogCancelCallback } = {},
): Promise<ExtensionDialogCard> {
  const card = new ExtensionDialogCard();
  card.dialog = dialog;
  if (callbacks.onAnswer !== undefined) card.onAnswer = callbacks.onAnswer;
  if (callbacks.onCancel !== undefined) card.onCancel = callbacks.onCancel;
  document.body.append(card);
  await card.updateComplete;
  return card;
}

function renderRoot(card: ExtensionDialogCard): ShadowRoot {
  return requiredElement(card.shadowRoot, "extension-dialog-card shadow root");
}

function buttonWithText(root: ShadowRoot, text: string): HTMLButtonElement {
  const matches = buttonsWithText(root, text);
  if (matches.length !== 1) throw new Error(`Expected exactly one button named ${text}, found ${String(matches.length)}`);
  const match = matches[0];
  return requiredElement(match, `button named ${text}`);
}

function buttonsWithText(root: ShadowRoot, text: string): HTMLButtonElement[] {
  return [...root.querySelectorAll("button")].filter((candidate) => candidate.textContent.trim() === text);
}

async function flushClose(card: ExtensionDialogCard): Promise<void> {
  // The card's close promise chain settles over several microtasks; a macrotask
  // flush waits for all of them plus the state change they schedule.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  await card.updateComplete;
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function openDialog(overrides: Partial<PendingExtensionDialog> = {}): PendingExtensionDialog {
  return {
    dialogId: "dlg-1",
    kind: "confirm",
    title: "Allow file writes?",
    askedAt: "2026-07-27T10:00:00.000Z",
    runScoped: false,
    ...overrides,
  };
}

function closedDialog(reason: ClosedExtensionDialog["reason"], answer?: ClosedExtensionDialog["answer"]): ClosedExtensionDialog {
  return {
    dialog: openDialog(),
    reason,
    ...(answer === undefined ? {} : { answer }),
  };
}
