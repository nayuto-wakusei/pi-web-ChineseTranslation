import type { ClientCommand } from "../types.js";

export const BUILTIN_COMMANDS: ClientCommand[] = [
  { name: "settings", description: "打开设置菜单", source: "builtin" },
  { name: "model", description: "选择模型", source: "builtin" },
  { name: "scoped-models", description: "启用/禁用可循环切换的模型", source: "builtin" },
  { name: "export", description: "导出会话", source: "builtin" },
  { name: "import", description: "从 JSONL 导入并恢复会话", source: "builtin" },
  { name: "share", description: "将会话分享到私密 GitHub gist", source: "builtin" },
  { name: "copy", description: "复制上一条代理消息", source: "builtin" },
  { name: "name", description: "设置会话显示名称", source: "builtin" },
  { name: "session", description: "显示会话信息和统计", source: "builtin" },
  { name: "changelog", description: "显示更新日志条目", source: "builtin" },
  { name: "hotkeys", description: "显示键盘快捷键", source: "builtin" },
  { name: "fork", description: "从之前的用户消息创建新分叉", source: "builtin" },
  { name: "clone", description: "在当前位置复制当前会话", source: "builtin" },
  { name: "tree", description: "导航会话树", source: "builtin" },
  { name: "login", description: "配置提供商认证", source: "builtin" },
  { name: "logout", description: "移除提供商认证", source: "builtin" },
  { name: "new", description: "启动新会话", source: "builtin" },
  { name: "compact", description: "手动压缩会话上下文", source: "builtin" },
  { name: "resume", description: "恢复另一个会话", source: "builtin" },
  { name: "reload", description: "重新加载键位、扩展、技能、提示词和主题", source: "builtin" },
  { name: "quit", description: "退出 pi", source: "builtin" },
];

export function isBuiltinCommand(name: string): boolean {
  return BUILTIN_COMMANDS.some((command) => command.name === name);
}
