import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceFileDownloadUrl } from "./urls";

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
});
