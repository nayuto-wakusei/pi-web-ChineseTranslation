// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionCleanupPreviewResponse } from "../api";
import { SessionCleanupDialog } from "./SessionCleanupDialog";

const preview: SessionCleanupPreviewResponse = {
  generatedAt: "2026-08-21T01:00:00.000Z",
  thresholds: { archiveIdleDays: 30 },
  projects: [{ cwd: "/repo", archiveCount: 1, deleteCount: 0 }],
  totals: { archiveCount: 1, deleteCount: 0 },
};

describe("SessionCleanupDialog", () => {
  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  it("enables cleanup from the returned preview thresholds", async () => {
    const dialog = new SessionCleanupDialog();
    dialog.preview = preview;
    document.body.append(dialog);

    await dialog.updateComplete;
    await dialog.updateComplete;

    const runButton = dialog.shadowRoot?.querySelector<HTMLButtonElement>("button.danger");
    expect(runButton?.disabled).toBe(false);
    expect(dialog.shadowRoot?.textContent).not.toContain("阈值已更改");
  });
});
