import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceFileDownloadUrl, workspaceFileWriteUrl, workspaceImagePreviewUrl } from "./urls";

const originalLocation = globalThis.location;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "location", { value: originalLocation, configurable: true });
});

describe("workspace API URLs", () => {
  it("adds management embed parameters to direct workspace download URLs", () => {
    Object.defineProperty(globalThis, "location", {
      value: { href: "http://pi.example.test/?embed=management&token=launch-token" },
      configurable: true,
    });

    expect(workspaceFileDownloadUrl("p 1", "w 1", "src/readme.md", { machineId: "local" })).toBe(
      "/api/machines/local/projects/p%201/workspaces/w%201/file/download?path=src%2Freadme.md&embed=management&token=launch-token",
    );
  });

  it("adds management embed parameters to workspace write and preview URLs", () => {
    Object.defineProperty(globalThis, "location", {
      value: { href: "http://pi.example.test/?embed=management&token=launch-token" },
      configurable: true,
    });

    expect(workspaceFileWriteUrl("p 1", "w 1", "src/readme.md", { machineId: "local", overwrite: false })).toBe(
      "/api/machines/local/projects/p%201/workspaces/w%201/file?path=src%2Freadme.md&overwrite=false&embed=management&token=launch-token",
    );
    expect(workspaceImagePreviewUrl("p 1", "w 1", "diagram.svg", { machineId: "local", modifiedAt: "2026-05-25T00:00:00.000Z" })).toBe(
      "/api/machines/local/projects/p%201/workspaces/w%201/file/preview?path=diagram.svg&v=2026-05-25T00%3A00%3A00.000Z&embed=management&token=launch-token",
    );
  });
});
