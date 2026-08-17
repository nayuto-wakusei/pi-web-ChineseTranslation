import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceFileDownloadUrl, workspaceFilePreviewPath, workspaceFilePreviewUrl, workspaceFileWriteUrl, workspaceImagePreviewUrl } from "./urls";

const originalLocation = globalThis.location;

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "location", { value: originalLocation, configurable: true });
});

describe("workspace API URLs", () => {
  it("encodes every dynamic preview path value exactly once", () => {
    expect(workspaceFilePreviewPath("project /?#%", "workspace /?#%", "reports/a b?#%/résumé.pdf", {
      machineId: "remote /?#%",
      modifiedAt: "2026-06-25T00:00:00.000Z +?",
      download: true,
    })).toBe("api/machines/remote%20%2F%3F%23%25/projects/project%20%2F%3F%23%25/workspaces/workspace%20%2F%3F%23%25/file/preview?path=reports%2Fa+b%3F%23%25%2Fr%C3%A9sum%C3%A9.pdf&v=2026-06-25T00%3A00%3A00.000Z+%2B%3F&download=1");
  });

  it("resolves preview paths once under a nested deployment", () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/nested/pi-web/" });
    Object.defineProperty(globalThis, "location", { value: { href: "https://pi.example.test/nested/pi-web/" }, configurable: true });
    expect(workspaceFilePreviewUrl("project /?", "workspace /?", "docs/report #1.html", { machineId: "remote /?", download: true })).toBe(
      "https://pi.example.test/nested/pi-web/api/machines/remote%20%2F%3F/projects/project%20%2F%3F/workspaces/workspace%20%2F%3F/file/preview?path=docs%2Freport+%231.html&download=1",
    );
  });

  it("adds management embed parameters to direct workspace download URLs", () => {
    Object.defineProperty(globalThis, "location", {
      value: { href: "http://pi.example.test/?embed=management&token=launch-token" },
      configurable: true,
    });

    expect(workspaceFileDownloadUrl("p 1", "w 1", "src/readme.md", { machineId: "local" })).toBe(
      "https://pi.example.test/api/machines/local/projects/p%201/workspaces/w%201/file/preview?path=src%2Freadme.md&download=1&embed=management&token=launch-token",
    );
  });

  it("adds management embed parameters to workspace write and preview URLs", () => {
    Object.defineProperty(globalThis, "location", {
      value: { href: "http://pi.example.test/?embed=management&token=launch-token" },
      configurable: true,
    });

    expect(workspaceFileWriteUrl("p 1", "w 1", "src/readme.md", { machineId: "local", overwrite: false })).toBe(
      "https://pi.example.test/api/machines/local/projects/p%201/workspaces/w%201/file?path=src%2Freadme.md&overwrite=false&embed=management&token=launch-token",
    );
    expect(workspaceImagePreviewUrl("p 1", "w 1", "diagram.svg", { machineId: "local", modifiedAt: "2026-05-25T00:00:00.000Z" })).toBe(
      "https://pi.example.test/api/machines/local/projects/p%201/workspaces/w%201/file/preview?path=diagram.svg&v=2026-05-25T00%3A00%3A00.000Z&embed=management&token=launch-token",
    );
  });
});
