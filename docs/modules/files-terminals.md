# 文件、终端与工作区任务

[返回文档目录](../maintenance.md) · 前置：[维护者上手](../getting-started.md)

## 维护契约

本模块跨两个生命周期：工作区文件 API 由 Web 路由和文件服务处理；长期终端由 daemon 的终端能力托管。上传、提示词内联附件和附件落盘不是同一条 API，修改大小/路径规则时要逐条核对。

| 路径 | 代码所有者 | 修改联动 |
| --- | --- | --- |
| 文件树/读写 | workspaceExplorerRoutes → fileTree/fileContent/fileOperation 服务 | pathSafety、pathAccessPolicy、响应 parser |
| 媒体预览 | filePreviewService + response policy/headers | shared workspaceFiles 分类/限额、远端代理预算 |
| 会话附件 | 编辑器暂存 → SessionController → attachmentService | 临时 ID 迁移、目录配置、SDK 图片转换 |
| 终端 | RequiredTerminalService → terminal 插件 | 命令状态、PTY/连接清理、机器身份 |
| 工作区任务 | workspace-tasks config/taskRunner | 严格解析、确认、终端能力，不新造命令执行器 |

文件安全测试要区分父路径链接、最终文件链接、已存在文件与新建文件，不能只做字符串前缀判断。预览测试需覆盖字节限额、截断、响应头和取消；浏览器附件测试覆盖添加/移除/reset 以及 ID 迁移。终端涉及 native PTY 的行为用真实平台验证，mock 不能证明进程回收。重启范围按上表所有者判断。

## 文件浏览与预览

选择工作区后在文件面板展开目录，点击文件查看源码或支持的预览。聊天中的工作区文件链接交给文件预览入口，不应当成网关机器的路径。文件位于哪台机器，就由哪台机器解析和读取。

| 类型 | 行为与限制 |
| --- | --- |
| 文本/代码 | JSON 内容读取上限 512 KiB，超出返回截断标记，不代表完整文件 |
| Markdown | 可预览与查看源码；相对文件链接按工作区解析 |
| 图片、PDF | 使用独立字节预览通道，而非将二进制塞进 JSON |
| HTML、SVG | 支持的源码/预览按安全响应策略处理，不等于可信应用部署 |
| 媒体内联预览 | 上限 10 MiB；过大应下载或另用本机工具查看 |
| Mermaid | 插件默认手动点击渲染，在本地隔离沙箱运行，不提交远端图表服务 |

预览不是通用桌面文件查看器，不保证所有格式可用。截断文件不得从展示片段推断完整内容或直接覆盖原件。下载与内联预览是不同路径，不能把 10 MiB 预览上限当作下载上限。

## 文件操作与外部路径

文件接口提供写入、移动、删除和目录操作，实际按钮按面板能力展示。修改前确认工作区与相对路径；删除会影响磁盘，不进入“会话归档”。重要内容先提交版本或备份。

默认只能通过浏览器文件接口读取工作区内部相对路径。确需查看外部目录时，在所选机器/项目配置 `pathAccess.allowedPaths`；它仅允许相应根的浏览/读取，不把外部根变成写入工作区。

解析会检查真实路径和符号链接，拒绝 `..` 或链接逃逸。允许路径必须在目标机器真实存在；Windows 路径只在 Windows 宿主有相应含义。这套边界限制浏览器文件暴露，**不是普通代理 shell 的沙箱**。详细配置见[外部路径访问](../config.md#external-path-access)。

## 手动上传与提示词附件

| 操作 | 结果 | 默认位置 |
| --- | --- | --- |
| 文件面板拖放 | 立即上传，不覆盖已存在文件 | `.pi-web/uploads` |
| 文件面板“上传” | 先审核，可调整目录与覆盖选项 | 项目有效上传目录 |
| 提示词内联附件 | 按支持的内容类型送入提示词；图片可经 SDK 调整大小 | 不等同于普通文件上传 |
| 附件“保存到…” | 文件落盘，提示词引用路径而非内联全部内容 | `.pi-web/attachments` |

推荐流程：选择正确工作区 → 选择投递方式 → 检查文件名、目录和覆盖选项 → 提交 → 查看完成/冲突/失败结果。上传成功只说明文件落盘，不等于代理已经读过。

项目目录配置覆盖机器默认值，显式附件请求目录优先。目录应相对工作区；手动上传审核对话框可特意清空到根目录，不能把这种单批次行为当作默认配置的合法空值。大小限制由执行上传的机器控制。详见[上传](../config.md#manual-upload-defaults)和[附件](../config.md#prompt-attachments)。

待发送附件必须随添加、移除和编辑器重置同步，不能只在切换会话时同步。临时会话转正式 ID 时保留尚未发送的附件，不能重新创建已废弃的临时 key；测试 controller 迁移完成、编辑器下一次更新之前的状态。这不等于承诺本地文件对象跨浏览器重启永久保存。

## 交互终端与命令运行

终端由 daemon 与终端插件托管，运行在当前机器的工作区。浏览器通过 WebSocket 显示输出和传递输入；刷新 Web 不应主动销毁终端。终端进程不是浏览器里的模拟 shell，执行删除、安装、推送会真实改变目标环境。

交互终端适合人工连续操作；命令运行有可追踪的 run ID、状态及取消入口，适合任务按钮和删除工作区等流程。创建命令记录不等于成功，应看退出结果。取消也不会回滚已写入的文件。

普通模式终端插件是必需能力，只有紧急安全启动等特殊路径才跳过。daemon 重启可能中断终端和会话，不要从需要保留的终端里重启它自己的宿主。管理嵌入的浏览器交互终端另行授权，不能根据代理有 bash 权限推断终端一定开放。

## 工作区任务

“任务”插件把项目维护者预定义的命令放到工作区面板。项目 `.pi-web/tasks.json` 示例：

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "app.test",
      "title": "运行测试",
      "description": "执行项目定义的测试脚本",
      "group": "验证",
      "command": "npm test",
      "confirm": true
    }
  ]
}
```

运行前确认项目确实定义了该命令。`id` 必须唯一，匹配 `^[a-z][a-z0-9.-]*$`；`title` 和 `command` 必须非空，`description`/`group` 可选但提供时非空，`confirm` 默认 false。高风险命令应设 true，但确认框不是安全沙箱。

任务运行在所选工作区终端，不是后台定时器。禁用插件隐藏入口，不删除任务文件。插件开发契约与更多示例仍以[插件指南](../plugins.md#included-tools-and-optional-packages)为准。

## 故障定位与自检

- 看不到文件：先核对机器/cwd，再看路径权限、文件是否存在以及提供器状态。
- 上传冲突：审核后更名或明确选择覆盖，不反复拖放期待静默覆盖。
- 预览空白：检查类型、大小、截断与插件状态，必要时下载；不要关闭安全策略绕过。
- 终端不可用：检查目标 daemon、终端插件实际状态及 node-pty 诊断，不只刷新前端。
- 任务不显示：检查 JSON 语法、版本、重复 ID 和插件启用状态。

在临时目录验收上传同名冲突、文本/图片预览和路径越界拒绝；在终端运行无副作用命令，刷新后确认输出与会话关联正确。工作区任务用简单测试命令验证，不执行数据库重置或真实部署作为烟测。

## 实现与回归入口

- 文件路由：[workspaceExplorerRoutes.ts](../../src/server/workspaceExplorerRoutes.ts)、[文件接口测试](../../src/server/app.workspaceFiles.test.ts)。
- 预览预算：[workspaceFiles.ts](../../src/shared/workspaceFiles.ts)、[filePreviewService.ts](../../src/server/workspaces/filePreviewService.ts)、[预览测试](../../src/server/app.workspaceFilePreview.test.ts)。
- 附件：[attachmentService.ts](../../src/server/sessions/attachmentService.ts)、[附件暂存测试](../../src/client/src/promptAttachmentStaging.test.ts)。
- 终端：[requiredTerminalService.ts](../../src/server/terminals/requiredTerminalService.ts)、[TerminalFacade.ts](../../pi-web-plugins/terminal/TerminalFacade.ts)。
- 任务解析与执行：[config.ts](../../pi-web-plugins/workspace-tasks/config.ts)、[config.test.ts](../../pi-web-plugins/workspace-tasks/config.test.ts)、[taskRunner.ts](../../pi-web-plugins/workspace-tasks/taskRunner.ts)。
