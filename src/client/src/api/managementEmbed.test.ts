import { afterEach, describe, expect, it, vi } from "vitest";
import { currentApiScope, isManagementEmbedMode, removeManagementEntryToken, withManagementEmbed } from "./managementEmbed";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("management embed API routing", () => {
  it.each([
    ["?embed=management", true],
    ["?embed=management&token=", true],
    ["?embed=normal", false],
    ["", false],
  ])("detects management UI mode from %j", (search, expected) => {
    expect(isManagementEmbedMode(search)).toBe(expected);
  });

  it("adds management embed query parameters to same-origin API requests", () => {
    const url = withManagementEmbed(
      "/api/projects",
      new URL("http://pi.example.test/?embed=management&token=launch-token"),
    );

    expect(url).toBe("/api/projects?embed=management&token=launch-token");
  });

  it("keeps cookie-authenticated management requests scoped after the entry token is removed", () => {
    const pageUrl = new URL("https://pi.example.test/?embed=management");

    expect(currentApiScope(pageUrl)).toBe("management");
    expect(withManagementEmbed("/api/projects", pageUrl)).toBe("/api/projects?embed=management");
  });

  it("removes the one-time entry token after management session establishment", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", { href: "https://pi.example.test/pi-web/?embed=management&token=launch-token&session=s1" });
    vi.stubGlobal("history", { state: { current: true }, replaceState });

    removeManagementEntryToken("management");

    expect(replaceState).toHaveBeenCalledWith({ current: true }, "", "/pi-web/?embed=management&session=s1");
  });

  it("preserves existing query parameters when adding management embed parameters", () => {
    const url = withManagementEmbed(
      "/api/projects/project-1/workspaces?path=src",
      new URL("http://pi.example.test/?embed=management&token=launch-token"),
    );

    expect(url).toBe("/api/projects/project-1/workspaces?path=src&embed=management&token=launch-token");
  });

  it("leaves direct access API requests unchanged", () => {
    const url = withManagementEmbed(
      "/api/projects",
      new URL("http://pi.example.test/"),
    );

    expect(url).toBe("/api/projects");
  });

  it("leaves management page API requests unchanged when the caller uses normal scope", () => {
    const url = withManagementEmbed(
      "/api/projects",
      new URL("http://pi.example.test/?embed=management&token=launch-token"),
      "normal",
    );

    expect(url).toBe("/api/projects");
  });

  it("adds management embed parameters when the caller uses management scope", () => {
    const url = withManagementEmbed(
      "/api/projects",
      new URL("http://pi.example.test/?embed=management&token=launch-token"),
      "management",
    );

    expect(url).toBe("/api/projects?embed=management&token=launch-token");
  });
});
