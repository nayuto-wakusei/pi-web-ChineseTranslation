import { describe, expect, it } from "vitest";
import { isManagementEmbedMode, withManagementEmbed } from "./managementEmbed";

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
