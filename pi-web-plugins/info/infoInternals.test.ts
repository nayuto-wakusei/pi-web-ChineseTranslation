import { describe, expect, it } from "vitest";
import type { PiWebComponentStatus, PiWebReleaseStatus, PiWebStatusResponse, PluginMachine, Workspace } from "@chainingintention/pi-web-cn/plugin-api";
import { componentDetails, componentHealth, diagnosticsSummary, formatVersion, installationLabel, machineKindLabel, releaseSummary, workspaceFlags } from "./infoInternals.js";

describe("componentHealth", () => {
  it("reports current when the component is available and not stale", () => {
    expect(componentHealth(componentStatus())).toBe("current");
  });

  it("reports restart needed when the installed version is newer than the running one", () => {
    expect(componentHealth(componentStatus({ stale: true }))).toBe("restart needed");
  });

  it("reports unavailable when the component cannot be reached", () => {
    expect(componentHealth(componentStatus({ available: false, stale: true }))).toBe("unavailable");
  });
});

describe("releaseSummary", () => {
  it("names the latest version when an update is available", () => {
    expect(releaseSummary(release({ updateAvailable: true, latestVersion: "1.2.3" }))).toBe("有可用更新：1.2.3");
  });

  it("still reports an update when the latest version is unknown", () => {
    expect(releaseSummary(release({ updateAvailable: true }))).toBe("有可用更新");
  });

  it("surfaces a failed release check", () => {
    expect(releaseSummary(release({ error: "registry unreachable" }))).toBe("更新检查失败：registry unreachable");
  });

  it("reports skipped checks distinctly from an up-to-date install", () => {
    expect(releaseSummary(release({ skipped: true }))).toBe("已跳过更新检查");
    expect(releaseSummary(release())).toBe("已是最新版本");
  });
});

describe("componentDetails", () => {
  it("combines versions, health, and installation into one line", () => {
    expect(componentDetails(componentStatus())).toBe("运行版本 1.0.0 · 安装版本 1.0.0 · 当前版本 · 全局 npm 包 · /usr/lib/node_modules");
  });

  it("includes the component error when present", () => {
    const details = componentDetails(componentStatus({ available: false, error: "connection refused" }));
    expect(details).toContain("不可用");
    expect(details).toContain("错误：connection refused");
  });
});

describe("diagnosticsSummary", () => {
  it("renders a full status block for bug reports", () => {
    const summary = diagnosticsSummary({ status: statusResponse(), machine: machineFixture(), workspace: workspaceFixture() });

    expect(summary).toBe([
      "PI WEB 诊断信息",
      "包：@chainingintention/pi-web-cn",
      "Web/界面：运行版本 1.0.0 · 安装版本 1.0.1 · 需要重启 · 全局 npm 包 · /usr/lib/node_modules",
      "会话守护进程：运行版本 1.0.0 · 安装版本 1.0.0 · 当前版本 · 本地检出 · /srv/dev/pi-web",
      "发布状态：有可用更新：1.1.0（检查于 2025-01-02T03:04:05Z）",
      "状态生成时间：2025-01-02T03:04:06Z",
      "机器：devbox（本地机器）",
      "工作区：pi-web - /srv/dev/pi-web（分支 main、Git 工作树、主工作区）",
    ].join("\n"));
  });

  it("degrades gracefully when the status and workspace are unavailable", () => {
    const summary = diagnosticsSummary({ status: undefined });

    expect(summary).toBe([
      "PI WEB 诊断信息",
      "状态：不可用",
      "工作区：未选择",
    ].join("\n"));
  });
});

describe("small formatters", () => {
  it("formats missing versions as unknown", () => {
    expect(formatVersion(undefined)).toBe("未知");
    expect(formatVersion("")).toBe("未知");
    expect(formatVersion("1.0.0")).toBe("1.0.0");
  });

  it("labels installations", () => {
    expect(installationLabel(undefined)).toBe("安装方式未知");
    expect(installationLabel({ kind: "pi-package", source: "Pi package", scope: "user" })).toBe("Pi package · 用户范围");
    expect(installationLabel({ kind: "pi-package", source: "Pi package", scope: "project" })).toBe("Pi package · 项目范围");
    expect(installationLabel({ kind: "docker", dockerMode: "dev" })).toBe("Docker 开发运行时");
    expect(installationLabel({ kind: "docker" })).toBe("Docker 运行时");
    expect(installationLabel({ kind: "unknown" })).toBe("安装方式未知");
  });

  it("labels machine kinds", () => {
    expect(machineKindLabel("local")).toBe("本地机器");
    expect(machineKindLabel("remote")).toBe("远程机器");
  });

  it("describes workspaces without git metadata", () => {
    expect(workspaceFlags({
      id: "ws-1",
      projectId: "proj-1",
      path: "/srv/dev/plain",
      label: "plain",
      isMain: false,
      isGitRepo: false,
      isGitWorktree: false,
    })).toEqual(["非 Git 仓库"]);
  });
});

function componentStatus(patch: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    runtimeVersion: "1.0.0",
    installedVersion: "1.0.0",
    stale: false,
    available: true,
    installation: { kind: "npm-global", path: "/usr/lib/node_modules" },
    ...patch,
  };
}

function release(patch: Partial<PiWebReleaseStatus> = {}): PiWebReleaseStatus {
  return {
    packageName: "@chainingintention/pi-web-cn",
    updateAvailable: false,
    checkedAt: "2025-01-02T03:04:05Z",
    ...patch,
  };
}

function statusResponse(): PiWebStatusResponse {
  return {
    packageName: "@chainingintention/pi-web-cn",
    generatedAt: "2025-01-02T03:04:06Z",
    components: {
      web: componentStatus({ installedVersion: "1.0.1", stale: true }),
      sessiond: componentStatus({ component: "sessiond", label: "Session daemon", installation: { kind: "local", path: "/srv/dev/pi-web" } }),
    },
    release: release({ updateAvailable: true, latestVersion: "1.1.0" }),
    commands: {},
    messages: [],
  };
}

function machineFixture(): PluginMachine {
  return { id: "local", name: "devbox", kind: "local" };
}

function workspaceFixture(patch: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    projectId: "proj-1",
    path: "/srv/dev/pi-web",
    label: "pi-web",
    branch: "main",
    isMain: true,
    isGitRepo: true,
    isGitWorktree: true,
    ...patch,
  };
}
