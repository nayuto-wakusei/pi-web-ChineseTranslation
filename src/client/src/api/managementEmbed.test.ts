import { describe, expect, it } from "vitest";
import { withManagementEmbed } from "./managementEmbed";

describe("management embed API routing", () => {
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
});
