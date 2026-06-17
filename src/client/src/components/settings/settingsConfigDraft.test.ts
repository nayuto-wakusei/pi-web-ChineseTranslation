import { describe, expect, it } from "vitest";
import { configFromDraft, draftFromConfig } from "./settingsConfigDraft";

describe("settings config drafts", () => {
  it("converts PI WEB config values to editable general settings drafts", () => {
    expect(draftFromConfig({ host: "0.0.0.0", port: 8504, allowedHosts: ["example.local", "192.168.1.20"] })).toEqual({
      host: "0.0.0.0",
      port: "8504",
      allowedHostsMode: "list",
      allowedHostsText: "example.local\n192.168.1.20",
    });
    expect(draftFromConfig({ allowedHosts: true }).allowedHostsMode).toBe("all");
  });

  it("converts drafts back to config while preserving shortcut and plugin preferences", () => {
    expect(configFromDraft({
      host: " 127.0.0.1 ",
      port: "9000",
      allowedHostsMode: "list",
      allowedHostsText: "example.local, 192.168.1.20\n",
    }, { shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null }, plugins: { info: { enabled: false } } })).toEqual({
      host: "127.0.0.1",
      port: 9000,
      allowedHosts: ["example.local", "192.168.1.20"],
      shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null },
      plugins: { info: { enabled: false } },
    });
  });

  it("preserves the spawnSessions flag when saving general settings", () => {
    const result = configFromDraft({
      host: "",
      port: "",
      allowedHostsMode: "list",
      allowedHostsText: "",
    }, { spawnSessions: true });
    expect(result.spawnSessions).toBe(true);
  });
});
