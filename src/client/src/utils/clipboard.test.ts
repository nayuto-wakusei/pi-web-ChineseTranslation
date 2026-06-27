import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeClipboard } from "./clipboard";

describe("writeClipboard", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: writeTextMock } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when navigator.clipboard.writeText succeeds", async () => {
    const ok = await writeClipboard("hello");

    expect(ok).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("hello");
  });

  it("returns false when navigator.clipboard.writeText throws", async () => {
    writeTextMock.mockRejectedValue(new Error("denied"));

    const ok = await writeClipboard("fail");

    expect(ok).toBe(false);
  });
});
