import { describe, expect, it } from "vitest";
import {
  agentProfileConfigPatchFromDraft,
  agentProfileDraftFromConfig,
  agentProfileDraftMatchesConfig,
  gatewayServerConfigFromDraft,
  gatewayServerDraftFromConfig,
  machineAccessConfigPatchFromDraft,
  machineAccessDraftFromConfig,
} from "./settingsConfigDraft";

describe("settings config drafts", () => {
  it("splits gateway server and selected-machine access drafts", () => {
    const config = {
      host: "0.0.0.0",
      port: 8504,
      allowedHosts: ["example.local", "192.168.1.20"],
      pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] },
      uploads: { defaultFolder: "manual/uploads" },
      attachments: { defaultFolder: "saved/attachments" },
    };

    expect(gatewayServerDraftFromConfig(config)).toEqual({
      host: "0.0.0.0",
      port: "8504",
      allowedHostsMode: "list",
      allowedHostsText: "example.local\n192.168.1.20",
    });
    expect(machineAccessDraftFromConfig(config)).toEqual({
      allowedPathsText: "/tmp\n~/SDKs",
      uploadDefaultFolder: "manual/uploads",
      attachmentDefaultFolder: "saved/attachments",
    });
    expect(gatewayServerDraftFromConfig({ allowedHosts: true }).allowedHostsMode).toBe("all");
  });

  it("builds one atomic agent profile patch from both draft fields", () => {
    expect(agentProfileDraftFromConfig({ agent: { command: "agent-lab", dir: "/srv/agent-lab" } })).toEqual({
      command: "agent-lab",
      dir: "/srv/agent-lab",
    });
    expect(agentProfileConfigPatchFromDraft({ command: " alternate-agent ", dir: " /srv/alternate-agent " })).toEqual({
      agent: { command: "alternate-agent", dir: "/srv/alternate-agent" },
    });
    expect(agentProfileConfigPatchFromDraft({ command: " ", dir: " " })).toEqual({ agent: {} });
    expect(agentProfileConfigPatchFromDraft({ command: " C:\\tools\\pi.exe ", dir: " C:\\agent-profiles\\work " })).toEqual({
      agent: { command: "C:\\tools\\pi.exe", dir: "C:\\agent-profiles\\work" },
    });
    expect(agentProfileDraftMatchesConfig({ command: " agent-lab ", dir: " /srv/agent-lab " }, { agent: { command: "agent-lab", dir: "/srv/agent-lab" } })).toBe(true);
    expect(agentProfileDraftMatchesConfig({ command: "agent-lab", dir: "/draft" }, { agent: { command: "agent-lab", dir: "/saved" } })).toBe(false);
  });

  it("builds gateway server saves without dropping preserved config values", () => {
    expect(gatewayServerConfigFromDraft({
      host: " gateway.local ",
      port: "9000",
      allowedHostsMode: "all",
      allowedHostsText: "ignored.local",
    }, {
      shortcuts: { "core:view.chat": "mod+1" },
      plugins: { info: { enabled: false } },
      normalAuth: { passwordHash: "pbkdf2-sha256$120000$c2FsdA$ZmFrZS1oYXNo" },
      pathAccess: { allowedPaths: ["/old"] },
      uploads: { defaultFolder: "old/uploads" },
      attachments: { defaultFolder: "old/attachments" },
      maxUploadBytes: 1234,
      spawnSessions: true,
      subsessions: false,
      agent: { command: "agent-lab", dir: "~/agent-profiles/lab" },
    })).toEqual({
      host: "gateway.local",
      port: 9000,
      allowedHosts: true,
      shortcuts: { "core:view.chat": "mod+1" },
      plugins: { info: { enabled: false } },
      normalAuth: { passwordHash: "pbkdf2-sha256$120000$c2FsdA$ZmFrZS1oYXNo" },
      pathAccess: { allowedPaths: ["/old"] },
      uploads: { defaultFolder: "old/uploads" },
      attachments: { defaultFolder: "old/attachments" },
      maxUploadBytes: 1234,
      spawnSessions: true,
      subsessions: false,
      agent: { command: "agent-lab", dir: "~/agent-profiles/lab" },
    });

    expect(gatewayServerConfigFromDraft({
      host: "",
      port: "",
      allowedHostsMode: "list",
      allowedHostsText: "example.local, 192.168.1.20\n",
    })).toEqual({ allowedHosts: ["example.local", "192.168.1.20"] });
  });

  it("builds selected-machine access/upload patches only from selected-machine-safe fields", () => {
    const patch = machineAccessConfigPatchFromDraft({
      allowedPathsText: "/tmp\n~/SDKs\n",
      uploadDefaultFolder: " manual\\uploads/. ",
      attachmentDefaultFolder: " saved\\attachments/. ",
    });

    expect(Object.keys(patch)).toEqual(["pathAccess", "uploads", "attachments"]);
    expect(patch).toEqual({
      pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] },
      uploads: { defaultFolder: "manual/uploads" },
      attachments: { defaultFolder: "saved/attachments" },
    });
  });

  it("clears selected-machine access/upload settings with safe default patches", () => {
    expect(machineAccessConfigPatchFromDraft({ allowedPathsText: "", uploadDefaultFolder: "", attachmentDefaultFolder: "" })).toEqual({
      pathAccess: { allowedPaths: [] },
      uploads: {},
      attachments: {},
    });
  });

  it("rejects invalid selected-machine upload default folders before saving", () => {
    expect(() => machineAccessConfigPatchFromDraft({ allowedPathsText: "", uploadDefaultFolder: "/tmp/uploads", attachmentDefaultFolder: "" })).toThrow("上传默认文件夹必须是工作区相对路径。");
    expect(() => machineAccessConfigPatchFromDraft({ allowedPathsText: "", uploadDefaultFolder: "../secret", attachmentDefaultFolder: "" })).toThrow("上传默认文件夹不能包含路径穿越。");
    expect(() => machineAccessConfigPatchFromDraft({ allowedPathsText: "", uploadDefaultFolder: "", attachmentDefaultFolder: "../secret" })).toThrow("附件默认文件夹不能包含路径穿越。");
  });

  it("rejects relative external paths before saving selected-machine access", () => {
    expect(() => machineAccessConfigPatchFromDraft({
      allowedPathsText: "relative/path",
      uploadDefaultFolder: "",
      attachmentDefaultFolder: "",
    })).toThrow("允许的外部路径必须是绝对路径或以 ~ 开头");
  });
});
