import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("core UI Chinese display copy", () => {
  it("localizes the navigation/sidebar labels shown in the main shell", () => {
    const text = [
      source("components/appShell/AppNavigationPanel.ts"),
      source("components/ProjectList.ts"),
      source("components/WorkspaceList.ts"),
      source("components/SessionList.ts"),
    ].join("\n");

    expect(text).toContain("操作");
    expect(text).toContain("项目");
    expect(text).toContain("工作区");
    expect(text).toContain("会话");
    expect(text).not.toContain(">Actions<");
    expect(text).not.toContain("▾ Projects");
    expect(text).not.toContain("▾ Workspaces");
    expect(text).not.toContain("▾ Sessions");
    expect(text).not.toContain("No project selected");
    expect(text).not.toContain("No workspace selected");
    expect(text).not.toContain("No session selected");
    expect(text).not.toContain(" messages");
  });

  it("localizes the prompt editor controls and placeholder", () => {
    const text = source("components/PromptEditor.ts");

    expect(text).toContain("给 pi 发送消息");
    expect(text).toContain("使用 / 输入命令");
    expect(text).toContain("发送");
    expect(text).toContain("停止");
    expect(text).not.toContain("Message pi...");
    expect(text).not.toContain("Use / for commands");
    expect(text).not.toContain(">Send<");
    expect(text).not.toContain(">Stop<");
  });

  it("localizes the chat event labels and history boundary copy", () => {
    const text = `${source("components/ChatView.ts")}\n${source("chatGroups.ts")}`;

    expect(text).toContain("会话开始");
    expect(text).toContain("事件");
    expect(text).toContain("显示消息");
    expect(text).not.toContain("Beginning of session");
    expect(text).not.toContain("Showing messages");
    expect(text).not.toContain("live events");
  });

  it("localizes the terminal panel controls visible above the shell", () => {
    const text = source("components/TerminalPanel.ts");

    expect(text).toContain("按键");
    expect(text).toContain("+ 终端");
    expect(text).not.toContain(">Keys<");
    expect(text).not.toContain("+ Shell");
  });

  it("localizes the empty states shown before project and workspace selection", () => {
    const text = `${source("components/PiWebApp.ts")}\n${source("components/WorkspacePanel.ts")}`;

    expect(text).toContain("选择项目和工作区以开始会话。");
    expect(text).toContain("选择项目");
    expect(text).toContain("从侧边栏选择一个项目，然后选择工作区来查看文件、Git 或终端。");
    expect(text).not.toContain("Select a project and workspace to start a session.");
    expect(text).not.toContain("Select a project");
    expect(text).not.toContain("Choose a project from the sidebar");
    expect(text).not.toContain("Choose a workspace to inspect files, Git, or terminals.");
  });

  it("localizes the command palette navigation and panel layout actions", () => {
    const text = source("components/PiWebApp.ts");

    expect(text).toContain("聚焦机器");
    expect(text).toContain("将键盘焦点移到机器选择器");
    expect(text).toContain("聚焦项目");
    expect(text).toContain("将键盘焦点移到项目列表");
    expect(text).toContain("聚焦工作区");
    expect(text).toContain("将键盘焦点移到工作区列表");
    expect(text).toContain("聚焦会话");
    expect(text).toContain("将键盘焦点移到会话列表");
    expect(text).toContain("重置导航面板宽度");
    expect(text).toContain("将导航面板恢复为默认宽度");
    expect(text).toContain("重置工作区面板宽度");
    expect(text).toContain("将工作区面板恢复为默认宽度");
    expect(text).toContain("重置面板宽度");
    expect(text).toContain("将所有侧边面板恢复为默认宽度");
    expect(text).toContain("导航");
    expect(text).toContain("视图");
    expect(text).not.toContain("Focus Machines");
    expect(text).not.toContain("Move keyboard focus to the machine selector");
    expect(text).not.toContain("Reset Navigation Panel Size");
    expect(text).not.toContain("Restore the navigation panel to its default width");
  });

  it("localizes the live activity dock state labels", () => {
    const text = source("components/ChatView.ts");

    expect(text).toContain("activityStateLabel(activity.label)");
    expect(text).toContain("return activityStateLabel(state);");
    expect(text).toContain("空闲");
    expect(text).not.toContain("if (activity === undefined) return state;");
    expect(text).not.toContain("return activity.detail !== undefined && activity.detail !== \"\" ? `${activity.label}: ${activity.detail}` : activity.label;");
  });

  it("localizes model picker and session bulk action copy", () => {
    const text = `${source("components/PiWebApp.ts")}\n${source("components/SessionList.ts")}`;

    expect(text).toContain("选择模型");
    expect(text).toContain("当前");
    expect(text).toContain("选择可见");
    expect(text).toContain("已选");
    expect(text).toContain("归档所选");
    expect(text).toContain("完成");
    expect(text).not.toContain("Select Model");
    expect(text).not.toContain("✓ current");
    expect(text).not.toContain("Select visible");
    expect(text).not.toContain("} selected");
    expect(text).not.toContain("Archive selected");
    expect(text).not.toContain(">Done<");
    expect(text).not.toContain(">Archive<");
  });

  it("keeps the file upload control as one visible Chinese button", () => {
    const text = source("plugins/core/panels.ts");

    expect(text).toContain("aria-label=\"上传文件\"");
    expect(text).toContain("type=\"file\" multiple hidden");
    expect(text).not.toContain(">选择文件<");
    expect(text).not.toContain("Choose file");
    expect(text).not.toContain("未选择文件");
  });
});
