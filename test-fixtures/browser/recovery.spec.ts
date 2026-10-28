import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

async function recoveryPeer(page: Page) {
  const connections: WebSocketRoute[] = [];
  let text = "Initial history";
  let fail = false;
  await page.route("**/api/machines/local/sessions/recovery/transcript-snapshot?*", async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
      return;
    }
    await route.fulfill({ json: {
      page: { start: 0, total: 1, messages: [{ role: "assistant", content: [{ type: "text", text }] }] },
      status: { sessionId: "recovery", isStreaming: true, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 },
      seq: 0, partial: null,
    } });
  });
  await page.routeWebSocket(/\/api\/machines\/local\/sessions\/recovery\/events\?/, (socket) => { connections.push(socket); });
  return {
    connections,
    update: (next: string) => { text = next; },
    fail: (value: boolean) => { fail = value; },
  };
}

test("keeps successful background checks invisible", async ({ page }) => {
  await recoveryPeer(page);
  await page.goto("/recovery.html");
  await expect(page.getByRole("main", { name: "Conversation" })).toContainText("Initial history");
  await expect(page.locator("body")).toHaveAttribute("data-sync", "checked");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator("conversation-sync-notice")).toBeEmpty();
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-refresh")));
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("a history check catches up a silently stalled stream without losing the draft", async ({ page }) => {
  const peer = await recoveryPeer(page);
  await page.goto("/recovery.html");
  await expect(page.locator("body")).toHaveAttribute("data-sync", "checked");
  await page.getByRole("textbox", { name: "Draft" }).fill("Keep this draft");
  peer.update("Output missed during the stall");
  // No error/close and no chat frames. Periodic reconciliation uses this
  // same controller read without adding routine status messages.
  await expect(page.getByRole("main", { name: "Conversation" })).toContainText("Initial history");
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-refresh")));
  await expect(page.getByRole("main", { name: "Conversation" })).toContainText("Output missed during the stall");
  await expect(page.locator("body")).toHaveAttribute("data-sync", "checked");
  await expect(page.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep this draft");
  expect(peer.connections).toHaveLength(1);
});

test("a failed refresh leaves clear feedback and a keyboard-accessible refresh action", async ({ page }) => {
  const peer = await recoveryPeer(page);
  await page.goto("/recovery.html");
  await expect(page.locator("body")).toHaveAttribute("data-sync", "checked");
  await page.getByRole("textbox", { name: "Draft" }).fill("Keep this draft");
  peer.fail(true);
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-refresh")));
  await expect(page.getByRole("status")).toContainText("Could not refresh messages");
  const warningBox = await page.getByRole("status").boundingBox();
  const conversationBox = await page.getByRole("main", { name: "Conversation" }).boundingBox();
  if (warningBox === null || conversationBox === null) throw new Error("Expected visible warning and conversation");
  expect(warningBox.y + warningBox.height).toBeLessThanOrEqual(conversationBox.y + 1);
  await expect(page.getByRole("main", { name: "Conversation" })).toContainText("Initial history");
  const refresh = page.getByRole("button", { name: "Refresh messages" });
  await expect(refresh).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  peer.fail(false);
  peer.update("Caught up after refresh");
  await refresh.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main", { name: "Conversation" })).toContainText("Caught up after refresh");
  await expect(page.locator("body")).toHaveAttribute("data-sync", "checked");
  await expect(page.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep this draft");
  expect(peer.connections).toHaveLength(2);
  await expect(page.getByRole("status")).toHaveCount(0);
});
