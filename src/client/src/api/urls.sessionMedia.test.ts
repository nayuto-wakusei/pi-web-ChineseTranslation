import { afterEach, describe, expect, it, vi } from "vitest";
import { messagePath, sessionEventsPath, sessionMediaUrl, streamSnapshotPath, transcriptSnapshotPath } from "./urls";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("selected-machine native media URLs", () => {
  it("explicitly opts transcript and event readers into reference projection without changing machine/cwd", () => {
    const session = { id: "session /?#%", cwd: "/repo ?#%" };
    const paths = [messagePath(session, { limit: 9, before: 12 }, "remote /?#%"), transcriptSnapshotPath(session, { limit: 9 }, "remote /?#%"), streamSnapshotPath(session, "remote /?#%"), sessionEventsPath(session, "remote /?#%")];
    expect(paths.map((path) => new URL(path, "https://pi.example/").pathname)).toEqual(
      ["messages", "transcript-snapshot", "stream-snapshot", "events"].map((endpoint) => `/api/machines/remote%20%2F%3F%23%25/sessions/session%20%2F%3F%23%25/${endpoint}`),
    );
    for (const path of paths) {
      const url = new URL(path, "https://pi.example/");
      expect(url.searchParams.get("cwd")).toBe(session.cwd);
      expect(url.searchParams.get("media")).toBe("reference");
    }
    expect(new URL(paths[0] ?? "", "https://pi.example/").searchParams.get("before")).toBe("12");
  });

  it.each([false, true])("preserves nested application paths and management context (%s)", (management) => {
    vi.stubEnv("BASE_URL", "/nested/pi-web/");
    const href = `https://pi.example/nested/pi-web/${management ? "?embed=management&token=entry-token" : ""}`;
    vi.stubGlobal("location", new URL(href));
    vi.stubGlobal("document", { baseURI: href });
    const url = new URL(sessionMediaUrl({ id: "session /?#%", cwd: "/repo with spaces/?#%" }, "a".repeat(64), "remote /?#%"));
    expect(url.pathname).toBe(`/nested/pi-web/api/machines/remote%20%2F%3F%23%25/sessions/session%20%2F%3F%23%25/media/${"a".repeat(64)}`);
    expect(url.searchParams.get("cwd")).toBe("/repo with spaces/?#%");
    expect(url.searchParams.get("embed")).toBe(management ? "management" : null);
    expect(url.searchParams.get("token")).toBe(management ? "entry-token" : null);
    expect(url.searchParams.has("media")).toBe(false);
  });
});
