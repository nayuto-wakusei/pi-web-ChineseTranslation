import { describe, expect, it } from "vitest";
import { listStyles } from "./listStyles";

describe("list activity styles", () => {
  it("styles unread-only rows as static rather than ongoing activity", () => {
    expect(listStyles.cssText).toMatch(/\.activity-indicator\.unread\s*\{[^}]*animation:\s*none/);
    expect(listStyles.cssText).toContain(".unread-ring");
  });
});
