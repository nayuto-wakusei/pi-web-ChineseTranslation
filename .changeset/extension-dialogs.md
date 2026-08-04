---
"@chainingintention/pi-web-cn": patch
---

支持在浏览器中处理 Pi 扩展对话框：`ctx.ui.confirm()`、`ctx.ui.select()` 和 `ctx.ui.input()` 现在会在会话记录中以内联卡片显示，并返回用户的实际回答。该能力覆盖会话仍在启动时由 `session_start` 钩子打开的对话框，以及运行中的 `tool_call` 钩子对话框。回答通过独立的会话守护进程通道传递，而不进入提示词队列，因此等待回答的 `tool_call` 钩子不会阻塞运行。打开的对话框可在浏览器刷新后恢复；多个标签页中最先提交的回答生效；未回答的对话框会在运行中止、运行时替换或超时后安全结束。新增 `extensionDialogsTimeoutMs` 配置项作为无人处理时的安全超时，默认 5 分钟，设为 `0` 时永久等待。对话框支持始终启用；其他 `ExtensionUIContext` 界面能力（组件、状态、编辑器和 `custom`）仍未实现。
