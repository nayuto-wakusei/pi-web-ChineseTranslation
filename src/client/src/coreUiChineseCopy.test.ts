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
});
