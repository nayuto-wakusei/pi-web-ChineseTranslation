# PI WEB 配置参考

本页说明机器与项目配置、路径访问、上传和提示词附件、会话守护进程能力、插件期望状态与恢复、快捷键以及运行时环境。便于扫描的默认值、作用域和重启规则见[配置页面](https://pi-web.dev/config)。

<a id="config-files"></a>
## 配置文件

- **机器配置**：`$PI_WEB_CONFIG`；未设置时使用 `$XDG_CONFIG_HOME/pi-web/config.json` 或 `~/.config/pi-web/config.json`。
- **项目配置**：`<project>/.pi-web/config.json`，可提交到仓库。
- **托管数据**：`$PI_WEB_DATA_DIR`（默认 `~/.pi-web`），不是用户可编辑配置 API。

联邦模式下，会影响工作执行的设置针对所选机器：路径访问、上传/附件默认目录、上传限制、会话工具、插件启用与配置。网关 host/port/allowed-hosts、快捷键、机器注册和令牌仍保存在网关。远端不支持某项功能时明确报错，不静默使用网关配置。

Pi 包由目标机器的 `pi install`、`pi remove`、`pi update` 或 **设置 → Pi 包** 管理；PI WEB 的 `plugins` 只控制已发现的纯浏览器、纯服务端与双入口插件的期望状态，不安装、移除或更新包。

<a id="settings-target-and-drafts"></a>
### 设置目标与草稿

普通模式的设置对话框独立持有“配置机器”选择，只改变机器级设置的目标，不切换正在使用的项目、工作区或会话。网关配置、默认主题和快捷键仍属网关，浏览器主题覆盖仍属设备。存在未保存的文件访问或上传草稿时，切换设置机器前需确认放弃或继续编辑；管理模式不开放这套普通跨机器选择器。

通用设置分别持有网关与目标机器草稿：配置刷新只更新未编辑字段，不用其他机器的值重设当前草稿；保存返回的配置确认已提交值后，才结清对应提交，保存期间的新编辑仍保留。快捷键按操作行确认保存值，只清该行已提交且未再改动的草稿；回调结束本身不是保存确认，也不清其他行草稿。

<a id="chinese-language-plugin"></a>
### 中文语言插件

内置 `zh-cn` 默认启用，覆盖核心界面、内置插件、CLI 及 PI WEB 自有提示。要恢复英文，在有效机器配置中设置 `"plugins": { "zh-cn": { "enabled": false } }`。不新增语言选择器或语言配置文件，缺失词条回退英文。

浏览器语言由网关机器的开关决定，不随所选远端机器切换。每台机器的 CLI 和服务端读取自身配置；远端返回的提示保留远端语言。用户内容、模型回复、第三方输出、命令、错误码及协议字段不会被翻译。

修改后刷新网页；CLI 下次启动生效；服务端需重启。拆分部署时重启 `pi-web-sessiond.service` 和 Web 服务（开发安装为 `pi-web-ui-dev.service`），确保两者使用相同有效 `PI_WEB_CONFIG`。不支持运行中热切换。

普通模式模型凭据和自定义模型按注册项目存放在托管目录的 `auth.json`、`models.json`。同一项目所有工作区共享项目存储；首次使用从有效全局 Pi agent 文件复制一次，之后不回退或覆盖。认证、启动与列表请求必须解析到注册项目；运行中的会话保留创建时的项目 registry，即使项目之后关闭。管理嵌入使用独立的 `management-embed/auth.json` 与 `models.json`，不混用普通项目凭据。

### 已安装服务的自定义配置路径

`start`、`restart`、`doctor` 的就绪检查默认使用已安装服务保存的配置路径；命令的非空 `PI_WEB_CONFIG` 可覆盖。`doctor` 检查受管理安装，不代表所有自定义环境。

| 情况 | 行为或处理 |
| --- | --- |
| 使用已安装路径 | 正常执行 `pi-web start`、`restart`、`doctor` |
| 单次命令覆盖 | 设置非空 `PI_WEB_CONFIG`，不重写服务定义 |
| 更改服务路径 | `pi-web install --config /path/to/config.json` 重新生成 Web/API 和 daemon 定义 |
| 旧安装仅 Web 保存路径 | 重跑上述安装命令，对齐两个服务 |
| systemd 无法验证实际环境 | 管理器状态过期、实际 fragment 不同或管理值不可验证时失败，不猜测；受管理 `Environment=`（当前 `PI_WEB_CONFIG`）必须与定义一致；无关变量忽略，未改管理值的 drop-in 允许 |
| systemd 使用 `EnvironmentFile=` | 本地保留严格检查：无法验证文件内实际覆盖时失败，不采用上游仅警告的宽松策略 |
| launchd 使用旧路径或其他 plist 标签 | `start`/`doctor` 失败；`restart` 重新加载已安装 plist，可修复过期状态 |

<a id="startup-model-and-thinking-defaults"></a>
## 新会话模型与思考默认值

在模型或思考等级选择器中点击“新会话默认值”星标。实心星标表示已保存的默认值；点击选项本身只改变当前会话，星标不改变当前会话。

`defaultProvider`、`defaultModel`、`defaultThinkingLevel` 按机器上 **模式 × 项目** 保存至托管 `settings.preferences.json`，不写回共享 agent `settings.json`。普通模式与项目认证同目录；管理模式使用 `management-embed/projects/<hash>/`，不能唯一归属项目时使用 `management-embed/orphan/<cwdHash>/`。普通模式的 `enabledModels` 也按项目保存，管理模式不展示。

默认值无需重启，适用于新会话。项目 Pi 设置、显式启动选择及每模型思考设置仍有既定优先级。默认模型必须启用，否则选择首个启用模型。恢复会话保留原模型与思考等级。其他共享 agent 设置（包、扩展、代理等）继续读真实 agent 目录的 `settings.json`。

<a id="default-theme-and-streaming"></a>
## 应用主题与发送默认值

`defaultTheme` 是网关配置，形如 `{ "themeId": "plugin-id:theme-id", "auto": true }`：`themeId` 必须为限定贡献 ID，`auto` 必须为布尔值。`auto: true` 在该主题有明暗配对时跟随系统明暗，否则使用所选主题。浏览器设备已保存的主题覆盖优先；主题暂不可用时使用回退，不删除原选择。主题属于整个应用，不保存到当前远端机器；保存/刷新配置后生效，无需重启 daemon。

在 **设置 → 通用 → 主题** 中，“在此设备使用”保存浏览器覆盖，“设为默认”保存网关默认且不覆盖已有设备选择，“使用默认值”清除此浏览器覆盖。Auto 只在主题有明暗配对时跟随设备。

网关 `defaultStreamingBehavior` 为 `"steer"`（默认）或 `"followUp"`，决定流式工作期间编辑器的默认发送方式，不改变已在 daemon 中排队的消息。浏览器分区尺寸、编辑器偏好与普通导航顺序不是新的项目配置文件；导航顺序是按机器管理的托管状态，管理模式不共用普通存储。

<a id="session-naming-and-archives"></a>
## 会话命名与归档

机器配置 `sessionNaming` 仅接受以下可选字段，不提供项目覆盖。设置保存后用于后续命名请求，无需重启；每次请求固定自己的有效设置，不覆盖用户已命名会话，也不切换聊天模型。

| 字段 | 默认值 | 约束 |
| --- | --- | --- |
| `model` | 当前会话模型 | 精确 `provider/model-id`；使用原会话普通项目或管理 registry |
| `maxTokens` | `24` | 正安全整数 |
| `thinkingLevel` | `minimal` | 已知思考等级；`off` 不发送 reasoning 参数 |
| `timeoutMs` | `10000` | 总耗时，整数 `1..2147483647` 毫秒 |

模型不可用、超时或命名失败时使用首条消息的回退名称；标题语言跟随用户请求。命名设置不把项目凭据切换为全局凭据。

<a id="session-archive-directory"></a>

`sessionArchive.directory` 选择新归档内容目的地，非空环境变量 `PI_WEB_SESSION_ARCHIVE_DIR` 优先；默认 `$PI_WEB_DATA_DIR/archived-sessions`。配置路径或环境路径相对进程 cwd 解析为绝对路径，daemon 启动后固定，修改需重启 daemon。归档索引仍是 `$PI_WEB_DATA_DIR/archived-sessions.json`，已有记录继续指向原归档文件，不自动迁移。备份时覆盖索引、旧目录与新目的地，不只复制默认目录。

<a id="mcp-settings-and-authentication"></a>
## MCP 设置与认证

**设置 → MCP** 管理所选机器当前非归档会话中已启用、支持 OAuth 的 MCP 服务器认证；先选择可写、空闲且可信的会话。服务器配置由 Pi 的全局/项目设置和信任规则决定，这里不新增 `pi-web` MCP 服务器配置键，也不替代管理模式的 Workbench 受控 MCP 集成。

也可从操作面板选择 MCP 登录/注销，再选择服务器；设置页直接针对所选服务器。两者使用同一独立认证流程，不切到聊天；禁用、header 认证或 stdio 服务器不列为 OAuth 候选，同机器同时只能进行一项 MCP 认证操作。

专用认证仅支持所选 **Pi 1.3.0** 同一 SDK 的内部凭据适配，未知版本不保证兼容。普通项目与管理使用独立私有 MCP 凭据，不回退共享 agent 的 MCP OAuth 存储；完整特权仍是管理身份，受限管理不提供该流程。认证固定原机器、会话、cwd、项目和 scope，切换选择不会转移流程。注销删除对应保存凭据，影响使用该凭据的其他会话，但不禁用服务器或撤销提供方授权。详见[认证与模型](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/modules/auth-models.md#mcp-认证)。

<a id="reverse-proxy-deployment-paths"></a>
## 反向代理部署前缀

PI WEB 不需要专门的 URL 前缀配置。同一发布产物可用于 `/`、`/ai/`、`/test/ai/`。代理必须先把不带尾斜线的前缀重定向到带斜线地址，再剥离前缀转发同一认证范围的 HTTP 与 WebSocket。页面相对资源和 PWA 路径依赖这一契约，详见[反向代理安装指南](https://pi-web.dev/install#reverse-proxy-prefix)。

<a id="precedence"></a>
<a id="precedence-and-reloads"></a>
## 优先级与生效条件

机器运行配置顺序：内置默认值 → 全局配置 → 环境覆盖。支持的项目键之后应用，上传与附件目录以项目值覆盖，允许路径列表合并去重。

环境覆盖包含 `PI_WEB_HOST`、`PI_WEB_PORT`/`PORT`、`PI_WEB_ALLOWED_HOSTS`、`PI_WEB_MAX_UPLOAD_BYTES`、`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_WEB_SPAWN_SESSIONS`、`PI_WEB_SUBSESSIONS`、`PI_WEB_ASK_USER`、`PI_WEB_ENVIRONMENT_FACTS`。本地保留的旧 agent/companion 输入另见下文。

- host/port：重启 Web/API。
- 上传大小：目标机器 Web/API 与 daemon 都重启。
- 会话工具、扩展对话框超时、环境事实：重启 daemon。
- 路径访问：下次请求生效；已有视图可需刷新。
- 上传/附件目录：配置或工作区刷新后的新批次生效。
- 纯浏览器插件：刷新浏览器。影响 `serverModule` 的启用、设置、包来源或版本：手动重启目标 daemon，再刷新。
- `serverPlugins.safeStart`：下次 daemon 启动前、发现/导入插件前生效，通过恢复 CLI 管理。
- Pi 普通资源变更：每个空闲会话执行 `/reload`。服务端插件或全局提供器定义/连接变更仍需手动重启 daemon；已知提供器仅模型列表刷新无需重启。
- 快捷键：保存或配置刷新后生效。
- `workbenchIntegration`、管理特权配置或跨进程审计配置：Web/API 与 daemon 保持一致并重启；签名授权仍必须显式允许对应权限。

<a id="global-config-example"></a>
## 全局配置示例

```json
{
  "host": "127.0.0.1",
  "port": 8504,
  "pathAccess": { "allowedPaths": ["~/SDKs", "/opt/reference"] },
  "uploads": { "defaultFolder": ".pi-web/uploads" },
  "attachments": { "defaultFolder": ".pi-web/attachments" },
  "maxUploadBytes": 67108864,
  "sessionArchive": {
    "directory": "/srv/pi-web/archives"
  },
  "spawnSessions": true,
  "subsessions": true,
  "askUser": true,
  "extensionDialogsTimeoutMs": 300000,
  "environmentFacts": true,
  "plugins": { "workspace-tasks": { "enabled": true }, "updates": { "enabled": false } }
}
```

合并到已有文件，不覆盖无关设置或用户数据。

<a id="project-local-config-example"></a>
<a id="project-local-config"></a>
## 项目配置示例

```json
{
  "version": 1,
  "pathAccess": { "allowedPaths": ["~/project-reference"] },
  "uploads": { "defaultFolder": "manual/uploads" },
  "attachments": { "defaultFolder": "prompt-attachments" }
}
```

路径根必须是宿主绝对路径或 `~` 前缀，不支持相对根。项目上传/附件目录通过工作区有效配置返回，联邦访问使用目标项目的值；不依赖旧远端可选字段回退。插件可拥有独立文件，如 `.pi-web/tasks.json`。

<a id="project-plugin-settings"></a>
### 项目插件设置

支持项目设置的服务端插件可读取注册项目根目录的 `.pi-web/config.json` 中 `plugins.<id>.settings`，不是各 worktree 独立配置。项目顶层设置键覆盖机器值，嵌套对象整体替换而非深合并；`enabled` 仍只属于机器配置，项目声明会被拒绝。修改服务端插件的全局或项目设置后，手动重启目标 daemon。

<a id="git-worktree-discovery-hooks"></a>
### Git 工作树发现通知

Git 插件的 `plugins.git.settings.workspaceDiscoveryHooks` 为布尔值，默认 `true`，项目值覆盖机器值。支持命名 hooks 的 Git（2.54+）可安装自身命名通知，保留已有 hooks 且不修改 `core.hooksPath`；不支持时仍可按需刷新列表。通知仅提示宿主重新查询当前提供器，不直接注册工作区。修改后重启 daemon，浏览器刷新不能更新 hook 状态。

<a id="git-instance-namespace"></a>

多实例可用 daemon 环境变量 `PI_WEB_INSTANCE_NAMESPACE` 区分通知身份：1–32 个字母、数字、下划线或连字符，首字符为字母或数字；生产默认留空，开发实例使用 `dev`。名称应保持稳定；退役旧名称时先在旧名称下禁用发现 hooks 并重启完成清理，再切换名称。不自动接管或迁移其他实例/旧名称的 hook。

<a id="worktree-pre-remove-hook"></a>
## 工作区删除前钩子

在删除命令运行的工作区提供可执行 `.pi-web/hooks/worktree-pre-remove`，可清理绑定工作区的开发容器或其他资源。通常从项目主工作区运行，钩子可随仓库提交。

存在且可执行时，钩子与删除组成同一终端命令：

```sh
'<hook path>' '<workspace path>' && <workspace removal command>
```

Git 删除命令为 `git worktree remove '<worktree path>'`。

| 契约 | 行为 |
| --- | --- |
| 参数 | 恰好一个参数：被删除工作区的绝对路径 |
| 工作目录 | 删除命令执行的工作区，不是被删除的工作区 |
| 返回 0 | 继续删除 |
| 非零退出 | `&&` 失败关闭，工作区保留在磁盘 |
| 不存在或不可执行 | 当作无钩子，单独执行删除 |
| 无法探测且不是普通缺失 | 在关闭工作区终端之前失败 |
| 输出 | 与“删除工作区”终端命令一起展示 |

```sh
#!/bin/sh
# .pi-web/hooks/worktree-pre-remove
set -eu
worktree_path="$1"
# 停止绑定该工作区的开发容器，释放项目资源。
# 非零退出会阻止删除。
```

这是不限制工具的项目扩展点，不假定特定容器或资源管理系统。

<a id="configuration-matrix"></a>
## 配置矩阵

“机器”为所选机器；“网关”为当前浏览器连接的机器。`—` 为无配置文件键的纯环境变量。

| 配置 | JSON 键 | 环境变量 | 作用域 | 项目行为 / 生效 |
| --- | --- | --- | --- | --- |
| 监听地址 | `host` | `PI_WEB_HOST` | 网关 | 无项目键；重启 Web/API |
| 监听端口 | `port` | `PI_WEB_PORT`、`PORT` | 网关 | 无项目键；重启 Web/API |
| 开发允许主机 | `allowedHosts` | `PI_WEB_ALLOWED_HOSTS` | 网关开发服务 | 重启开发 Web/UI |
| 外部路径根 | `pathAccess.allowedPaths` | — | 机器 + 项目 | 全局后加项目，去重；下次文件请求 |
| 上传目录 | `uploads.defaultFolder` | — | 机器 + 项目 | 项目覆盖；新对话框/拖放批次 |
| 附件目录 | `attachments.defaultFolder` | — | 机器 + 项目 | 项目覆盖；新附件保存 |
| 请求大小 | `maxUploadBytes` | `PI_WEB_MAX_UPLOAD_BYTES` | 机器 | Web/API 与 daemon 重启 |
| 独立会话 | `spawnSessions` | `PI_WEB_SPAWN_SESSIONS` | daemon | 重启 daemon |
| 跟踪子会话 | `subsessions` | `PI_WEB_SUBSESSIONS` | daemon | 也需要 `spawnSessions`；重启 |
| 问题表单 | `askUser` | `PI_WEB_ASK_USER` | daemon | 重启 daemon |
| 扩展对话框超时 | `extensionDialogsTimeoutMs` | — | daemon | 重启 daemon |
| 环境事实 | `environmentFacts` | `PI_WEB_ENVIRONMENT_FACTS` | daemon | 重启 daemon |
| 插件期望状态 | `plugins.<id>.enabled/settings` | — | 机器 | 浏览器刷新；服务端重启后刷新 |
| 项目插件设置 | `plugins.<id>.settings` | — | 机器 + 项目 | 支持的服务端插件顶层覆盖；重启 daemon |
| Git 发现通知 | `plugins.git.settings.workspaceDiscoveryHooks` | — | 机器 + 项目 | 默认 `true`；重启 daemon |
| Git 通知 namespace | — | `PI_WEB_INSTANCE_NAMESPACE` | daemon | 默认空；开发为 `dev`；重启 daemon |
| 插件恢复 | `serverPlugins.safeStart` | — | 机器离线恢复 | 下次 daemon 启动前应用 |
| 快捷键 | `shortcuts.<actionId>` | — | 网关 | 保存/刷新配置 |
| 默认主题 | `defaultTheme.themeId/auto` | — | 网关 | 浏览器覆盖优先；保存/刷新配置 |
| 流式发送默认方式 | `defaultStreamingBehavior` | — | 网关 | `steer` 或 `followUp`；默认 `steer` |
| 会话命名 | `sessionNaming.model/maxTokens/thinkingLevel/timeoutMs` | — | 机器 | 后续命名请求生效；无项目覆盖 |
| 归档目的地 | `sessionArchive.directory` | `PI_WEB_SESSION_ARCHIVE_DIR` | daemon | 重启；不迁移既有归档或索引 |
| 项目版本 | `version` | — | 项目 | 存在时必须为 `1` |
| 配置文件 | — | `PI_WEB_CONFIG`、`XDG_CONFIG_HOME` | 进程 | 改环境后重启；不是项目配置 |
| 托管数据 | — | `PI_WEB_DATA_DIR` | Web/API + daemon | 两进程对齐重启；不自动迁移数据 |
| daemon socket | — | `PI_WEB_SESSIOND_SOCKET` | Web/API + daemon | 两端一致并重启；默认 `$PI_WEB_DATA_DIR/sessiond.sock` |
| daemon TCP 端口 | — | `PI_WEB_SESSIOND_PORT` | daemon | 重启并同步 Web 的 URL |
| daemon TCP 主机 | — | `PI_WEB_SESSIOND_HOST` | daemon | 重启 daemon |
| Web 到 daemon URL | — | `PI_WEB_SESSIOND_URL` | Web/API | 重启 Web/API |
| 项目注册表 | — | `PI_WEB_PROJECTS_FILE` | Web/API + daemon | 高级状态覆盖；两进程重启 |
| 远端注册表 | — | `PI_WEB_MACHINES_FILE` | Web/API | 高级状态覆盖；重启 Web |
| Pi 状态目录 | — | `PI_CODING_AGENT_DIR` | daemon | 重启；包/插件/共享 agent 设置使用该目录 |
| Pi 会话目录 | — | `PI_CODING_AGENT_SESSION_DIR` | daemon | 独立会话存储覆盖；重启 |
| 跳过版本检查 | — | `PI_WEB_SKIP_VERSION_CHECK`、`PI_SKIP_VERSION_CHECK` | Web/API | 重启 Web；不禁止模型目录刷新 |
| 离线 | — | `PI_WEB_OFFLINE`、`PI_OFFLINE` | Web/API + daemon | 两进程重启；也禁用模型目录网络刷新 |
| Docker 开发 socket | — | `PI_WEB_DEV_SESSIOND_SOCKET` | Docker 开发环境 | 默认 `/data/pi-web/sessiond-dev.sock`；生成配置和健康检查使用此值，不改变生产 socket |

<a id="key-details"></a>
## 关键细节

<a id="ordinary-mode-tool-audit"></a>
### 普通模式工具审计

保留 Pino/服务日志，同时将普通模式工具调用元数据存入 `$PI_WEB_DATA_DIR/audit/normal-tool-calls.sqlite`；管理调用不进入该数据库。行包含会话、工作区、工具/call ID、起止时间、耗时及 `started`、`completed`、`failed`、`interrupted` 状态，不保存参数、结果、提示词、模型回复或凭据。

`auditLog.normalMode.enabled` 默认 `true`，`retentionDays` 默认 `90`，`maxRows` 默认 `500000`。daemon 启动和每 24 小时清理；数据库错误记日志，不停止工具。WAL 允许 daemon 活跃时读取；优雅关闭和下次启动将未完成调用标记为 interrupted。改变配置重启 daemon。

```bash
pi-web audit list --since 24h
pi-web audit list --status failed --since 7d
pi-web audit stats --since 30d
pi-web audit export --since 30d --format csv --output audit.csv
pi-web audit prune --before 2026-05-01
pi-web audit vacuum
```

<a id="management-mode-elasticsearch-audit"></a>
### 管理模式 Elasticsearch 审计

保留服务日志，可通过 `auditLog.managementMode.enabled: true` 与 `baseUrl`（或 `PI_WEB_AUDIT_ES_URL`）开启 Elasticsearch。认证只读 daemon 环境：`PI_WEB_AUDIT_ES_API_KEY` 优先，基本认证须同时有 `PI_WEB_AUDIT_ES_USERNAME`/`PI_WEB_AUDIT_ES_PASSWORD`；URL 禁止携带凭据。

按上海日历 ISO 周写入如 `pi-web-management-audit-2026-w32` 的索引，`indexPrefix` 默认 `pi-web-management-audit`，`retentionDays` 默认 `365`。daemon 安装严格模板，经 Bulk API 批写，启动/每日维护；上海日历每月首次成功维护删除早于截止的 `@timestamp` 文档。

记录 `user.id`、`user.root_user_id`、实际工作区所属授权项目、Pi 会话和适用的 Workbench Agent Session。受限和完整特权管理会话均在 `content` 中保留用户问题文本、模型可见回复（排除 `thinking` 块）、工具参数和结果；该字段只存储、不建立索引。服务日志仍仅记录元数据，管理调用不进入普通模式 SQLite。Workbench 专项能力、知识检索、Skill 事件仍只存固定资源版本、授权修订、run/trace ID、状态、耗时、重试或结果数量等元数据；同一调用作为工具执行时，其参数与结果按工具审计保存。不额外记录认证状态中的令牌、API key、cookie 或票据。

ES 错误记日志，不停止管理会话。有界内存队列重试，并在优雅关闭刷写；崩溃可能丢失尚未送达记录。正文及工具内容可能含敏感数据，须用 ES/Kibana 索引权限限制审计访问。共享跨进程配置保持 Web/API 与 daemon 一致；升级审计实现后需手动重启 `pi-web-sessiond.service`。

<a id="workbench-and-mcp-integration"></a>
### Workbench 与 MCP 集成

`workbenchIntegration` 是管理嵌入的受控适配器，不限制普通会话。`baseUrl` 为服务器可访问的 Workbench 后端 origin，`mcpUrl` 为 MCP Streamable HTTP endpoint，两者必需。环境覆盖：`PI_WEB_WORKBENCH_URL`、`PI_WEB_MCP_URL`、`PI_WEB_WORKBENCH_TIMEOUT_MS`、`PI_WEB_MCP_TIMEOUT_MS`、`PI_WEB_SKILL_BUNDLE_MAX_BYTES`、`PI_WEB_SKILL_FILE_MAX_BYTES`、`PI_WEB_SKILL_FILE_COUNT_MAX`。

默认 request/capability 超时 10000/30000ms、Skill bundle/file 上限 10485760/2097152 字节、文件数 200。适配器把一次性管理 token 换成私有 Agent Session，仅加载授权固定资源快照；并发同 entry token 复用该 Agent Session。

受控工具为 `icnoc_search_capabilities`、`icnoc_call_capability`、`workbench_search_knowledge`、`workbench_retrieve_knowledge`、`workbench_retrieve_bookstack`、管理文件工具与 Bubblewrap 隔离的 `python`。知识访问经后端短期一次性 token，PI WEB 不配置 RAGFlow/BookStack 服务凭据，工具不接受 tenant/dataset ID。来源链接不是连接配置。全局开关允许时再提供 spawn/跟踪子会话/ask_user，子会话继承管理上下文及显式拒绝。

Python 与受限 bash 默认无网络，只绑定管理工作区及必要的只读运行库；bash 可在该工作区沙盒内执行命令，不默认暴露其他宿主目录。通用 MCP、HTTP、Web 搜索、宿主 shell 和交互终端默认拒绝。签名 token 的 `privileged.bash`/`privileged.network` 仅在机器 `managementEmbed.allowPrivileged: true`（默认 false）时生效；仅 tools.allow 不足以获得特权。单项授权仍采用受限模式，tools.allow/deny 继续有效：仅 bash 授权可提供工作区可写、其他宿主目录只读的沙盒；仅网络授权可启用 http/webfetch/websearch 并移除管理 Python/bash/terminal-command-runs 的 `--unshare-net`，但不增加宿主文件可见性。

**完整特权管理会话**要求机器 `managementEmbed.allowPrivileged: true`，且签名 token 的 `privileged.bash` 与 `privileged.network` 都为 true。此时代理使用与普通模式相同的 SDK 工具及资源加载机制，忽略管理 token 的 tools.allow/deny，不再应用管理工具的工作区沙盒和资源过滤。管理嵌入会话直接通过项目信任，无需普通页面预先批准，也不改写普通模式的信任决定。其宿主文件读写、网络和已配置 MCP 等能力受运行 daemon 的系统账号和普通权限配置约束，不代表自动获取操作系统 root 权限。

此模式不注册管理专属工作台工具及其“L0 只读能力”指令，不以工作台资源续期作为代理启动门槛，也不强制同步工作台 Skills 或覆盖项目 Relay 模板。工具定义和系统提示由普通会话相同的加载路径生成；已有项目文件不自动删除或改写，仍按普通模式加载。工作台外部服务自身的授权规则不会因此被改写。

平台标记的管理 AGENTS 指令，以及与签名上下文明确匹配的旧平台指令，不加入完整特权代理的系统提示；原文件不删除，用户自行编写的项目或全局指令保留。操作者的普通权限策略配置继续生效，不安装“全允许”策略，也不清空其环境配置。此切换仅影响代理运行时，不改变浏览器交互终端端点的独立授权。

完整特权不改变管理身份、独立模型认证及偏好存储、审计或子会话管理上下文，也不允许普通会话连接读取管理会话。Web/API 与 daemon 的特权配置须一致。仅向受信任的签名入口发放双授权；旧管理 allow/deny 不能限制这种完整特权会话。

Skill bundle 只从 MCP origin 下载，校验授权固定版本与 manifest，写入管理项目 `.pi/skills/`；token/票据不离开服务端。受限管理会话只加载所属项目允许范围内的 Skills；SDK 按名称去重时，被全局同名技能遮蔽的授权项目副本仍会恢复加载。启动及 `/reload` 时同步所属工作区的 `relay`、`relay-runner`，使用当前安装包随 SDK 适配的模板。项目 `.pi/skills/relay/` 与 `.pi/skills/relay-runner/` 是平台保留目录，其中旧模板会更新；其他自定义 Skill 不覆盖。普通模式及完整特权管理模式保留普通 SDK 资源加载行为，不执行这项模板同步。

完整特权管理会话在启动和 `/reload` 时仅清理确认是平台原样下发的项目 Relay 副本，改由已启用的内置 Relay 包提供技能。清理只匹配当前模板或已知历史模板，且目录中必须仅有普通文件 `SKILL.md`；用户改过的内容、额外文件、符号链接及其他自定义 Skill 均保留，真实同名冲突仍会提示。取消特权后，下次创建或重载受限管理会话会按上述受限模式规则重新下发当前模板；旧特权会话不会运行中自动降权，应停止使用并通过新的授权入口进入。普通模式不执行此清理。升级此行为需重启 `pi-web-sessiond.service`，不改变现有特权授权与沙箱规则。

`workbench_search_knowledge` 检索授权元数据，可用 provider=ragflow/bookstack；RAGFlow 内容用 retrieve_knowledge，BookStack 用 retrieve_bookstack，参数 resource_name、简洁 question、可选 resource_version=live、top_k 默认 8/最大 20。通过后端 `POST /api/knowledge-access/bookstack/retrieval` 读取独立授权的已发布书籍当前非草稿页，不编辑、不提供语义检索。返回纯文本、修订、更新时间、源 URL 与 knowledge:// 引用；truncated 表示搜索/文本限制，不保证包含所有匹配。上限五批各 100 候选、每页 8000 字符、总 40000。源链接仍需要读者自身浏览器权限，工具不授予 BookStack 登录。

先部署支持资源快照、knowledge token 和检索 endpoint 的 Workbench 后端，再更新 PI WEB；BookStack 凭据只在后端，不新增 PI WEB BookStack 配置。工具更新重启 daemon；共享 endpoint/limit 改变重启两进程。签名 `projects[].agentsInstructions` 仅在项目 AGENTS.md 不存在时独占创建，已有内容不覆盖，无此字段仍兼容，普通项目不受影响。

<a id="managed-data-directory"></a>
### 托管数据目录

默认 `~/.pi-web` 保存项目/机器注册表、本地插件、默认 daemon socket、归档索引及项目认证/偏好。新目录是独立实例，没有原注册表和归档，不自动迁移。需要迁移时先停服务，复制 `archived-sessions.json` 和每条记录指向的归档内容，包括自定义目的地；仅复制默认 `archived-sessions/` 不保证完整。

一个目录只能有一个活跃 daemon。第二实例需要独立数据目录、daemon endpoint 和 Web 端口。过期所有权通常自动恢复；启动仍拒绝时，必须先确认所报进程已退出，再按错误提示处理 `sessiond-owner.json`。不要删除活跃所有权文件。

所有权标记更新使用短时互斥目录 `sessiond-owner.json.lock`，不会按年龄自动抢占。若启动/停止进程在更新期间崩溃，后续操作会明确报锁冲突；必须确认没有 daemon 正在启动或停止，才可删除该残留空目录后重试。升级这一保护机制时，先完整停止旧 daemon，再启动新版本，避免旧版本绕过互斥保护。

该变量不改变 `PI_WEB_CONFIG` 或 Pi 自有会话存储。

<a id="agent-process-environment"></a>
### 代理进程环境

普通代理 shell、终端和子会话继承 daemon 环境；移除 `NODE_ENV`、`PORT`，避免 daemon 生产设置影响开发命令。PATH、HOME、代理变量和 `PI_WEB_*` 保留。daemon 导出已解析的 `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR`；运行时读取共享 agent 设置与会话路径，但模型认证仍遵循 owning-project registry，不能由子进程环境说明推断普通项目共享凭据。

会话启动的进程继承 `PI_WEB_SESSION=1`，表示处于现有 PI WEB 中。继承变量指向当前实例；误启动第二实例会因活跃数据目录所有权失败。刻意运行独立实例必须另设目录、endpoint 和端口。

系统提示词默认包含嵌套及 Docker 布局事实，提醒不要从需要保留的会话内重启宿主 daemon，并在受支持的开发重启中先启动 Web/API。可用 `environmentFacts: false` 或 `PI_WEB_ENVIRONMENT_FACTS=false` 禁用。管理嵌入仍使用受控工具和既定 Bubblewrap/网络/宿主权限策略，不直接继承普通模式工具权限。

<a id="external-path-access"></a>
### 外部路径访问

默认相对读取只在工作区内，绝对路径拒绝。`pathAccess.allowedPaths` 允许浏览器文件面板和绝对 `@` 补全列出/读取指定外部根。

允许 Unix 绝对路径 `/opt/reference`、家目录相对 `~/SDKs`、Windows 宿主上的 `C:\Users\dev\SDKs`。展开 `~`，通过 `realpath` 规范化根，要求存在目录，拒绝符号链接逃逸。不支持相对根。设置保存在所选机器，网关网络设置仍在网关。

这不是普通 Pi 代理或 OS 用户的沙箱，只约束浏览器/API 外部文件暴露。

<a id="manual-upload-defaults"></a>
### 手动上传默认目录

文件面板支持多文件：直接拖放立即上传到工作区有效目录；“上传”按钮打开审核对话框，可修改目录和选项。默认 `.pi-web/uploads`，项目 `uploads.defaultFolder` 覆盖机器默认值。

目录非空且必须相对工作区；重复分隔符和反斜线规范化为 `/`，绝对路径与 `..` 逃逸拒绝。仅审核对话框允许清空目录，把该批次上传到工作区根。默认创建父目录，不覆盖已有文件；审核可显式覆盖，直接拖放从不覆盖。进度展示完成、冲突和错误。联邦使用目标机器/项目目录，大小限制由服务上传的机器控制。

<a id="prompt-attachment-defaults"></a>
<a id="prompt-attachments"></a>
### 提示词附件默认目录

附件投递“保存到…”把文件写入工作区，并在提示词中引用路径，不以内联方式附加内容。默认 `.pi-web/attachments`，项目 `attachments.defaultFolder` 覆盖机器默认值；格式/逃逸规则与上传目录一致。显式附件 API 请求目录优先于配置。联邦设置保存在目标机器，编辑器使用有效项目目录。

<a id="agent-state-directory"></a>
<a id="agent-runtime"></a>
<a id="pi-compatible-agent-profile-and-companion-cli"></a>
### Pi 状态目录与本地兼容输入

会话复用已安装的 Pi npm SDK。`PI_WEB_PI_PACKAGE_DIR` 显式选择 SDK 包根目录，优先于普通 npm 解析与 PATH 中第一个 `pi`；无 SDK 包的独立二进制不受支持。显式路径无效时直接失败，不回退另一份 Pi。`/pi-web` 将宿主安装传给 CLI，新安装的原生服务保留这个选择；更改后须重装服务定义并重启 Web 与 daemon。doctor 和状态仍分别核对有效安装与 companion CLI，不能把 PATH 上可执行命令当作 SDK 已对齐的证据。

标准 `PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）选择共享 agent 设置、包与默认会话路径；`PI_CODING_AGENT_SESSION_DIR` 可独立指定会话路径。这些变量与 SDK 安装目录不同，不新增配置文件键。

```sh
PI_CODING_AGENT_DIR=/opt/pi-profiles/lab
PI_CODING_AGENT_SESSION_DIR=/opt/pi-profiles/lab-sessions
```

目录必须符合所选 SDK 数据布局；不转换不兼容格式，不迁移 profile，也不移动 PI WEB 归档。

daemon 启动时解析并固定目录，终端、bash、子会话使用相同值。运行期间改变环境不生效；包管理、插件发现、状态/安装识别和更新计划仍使用 daemon 的有效目录。Web 重启恢复同一有效目录，不独立解析新值。daemon 无法报告有效目录时，相关操作不可用，不自行回退。仅有效目录和可执行 companion CLI 都具备时提供包管理更新命令，并固定目录。

本地保留旧 `agent.command`/`agent.dir`、`PI_WEB_AGENT_COMMAND`/`PI_WEB_AGENT_DIR`/`PI_WEB_AGENT_SESSION_DIR` 和 Windows command/sessionDirEnvKeys 扩展，用于已有内部配置与 companion 行为；不扩展或拒绝上游两字段公开 v2 profile，不自动重写用户配置。弃用输入通过诊断提示，迁移请使用标准 Pi 环境变量；改变内部有效目录或命令仍需重启 daemon。

<a id="pi-extension-provider-baseline"></a>
### Pi 扩展提供器基线

普通模式提供器归属于注册项目的 `ProjectAuthService` 模型 registry，而不是全机共享；同项目工作区共享，其他项目和管理模式隔离。基线由 Pi 内置提供器、环境凭据、该项目托管 `models.json` 及全局 Pi 扩展/包建立；首次项目文件复制规则见[配置文件](#config-files)。PI WEB 工作区插件是另一概念。

连接设置在对应运行时基线建立后固定。项目扩展和 `/reload` 不能新增、替换或删除提供器；扩展其他功能正常加载与刷新。全局提供器定义、凭据/连接配置或实现变化需要手动重启 daemon，Web 重启和 `/reload` 不重建基线。

虚拟模型的 router 捕获会话上下文，不能存入同项目工作区共享的 registry。PI WEB 在全局扩展 bootstrap 前即拒绝 `registerVirtualModel`/`unregisterVirtualModel`，后续会话中也不能重新注册；使用物理模型。诊断不包含模型定义或 ID。

已知提供器仅模型列表变化、其他设置保持不变时可立即接受刷新，无需重启。更新按精确 registry 身份应用，只影响 owning project；同项目两个工作区注册不同列表时后注册者生效，不影响别的项目。模型条目可带 `baseUrl`/`headers`，覆盖该模型的提供器值；扩展仍是可信进程内代码，不是安全沙箱。

daemon 日志记录忽略的配置变更与模型列表应用，不输出提供器配置或凭据，不生成浏览器通知。管理 registry 独立；不能为对齐上游全局刷新而恢复跨项目共享。

<a id="background-model-catalog-refresh"></a>
<a id="catalog-refresh"></a>
### 后台模型目录刷新

目录网络刷新由 daemon 后台调度，请求自身不发起目录抓取，慢提供器不单独阻塞模型选择、启动或认证对话框。已在途刷新可能短暂影响对应 runtime 状态读取；会话活动行说明启动步骤及并发目录刷新，这是并发提示，不断言因果。

- daemon 启动 **15 秒**后首次运行，随后**每小时**检查。Pi 已保存目录四小时内视为新鲜，多数检查不联网。
- 登录/注销后按精确项目 registry 立即刷新，绕过新鲜度；管理 registry 独立。
- 每次最多 **60 秒**，超时/不可达五分钟后**只重试一次**；HTTP 错误留到下次计划。
- 失败不清空目录，保留最后成功结果并记日志；daemon 关闭会中止在途刷新。
- 下次请求模型列表才见新目录，已打开选择器可需重新打开。
- 设置 daemon 环境 `PI_WEB_OFFLINE` 或 `PI_OFFLINE` 后重启，完全禁止目录联网，包括登录后刷新；读取对应存储已有目录。
- `PI_WEB_SKIP_VERSION_CHECK`/`PI_SKIP_VERSION_CHECK` 只抑制版本检查，不禁止目录刷新。以上离线/跳过标记任意非空值（包括字符串 `0`、`false`）都启用，清空或移除才关闭。

<a id="project-trust-for-project-local-resources"></a>
### 项目信任

普通模式每次启动都先遵循 Pi 项目信任，再加载 `.pi/extensions/*`、`.pi/settings.json` 的包及其他项目资源，不能用配置关闭信任门槛。已有 `respectProjectTrust` 已移除，配置保存时移除该废弃键；读取不改写文件，也不会自动把已有项目设为可信。

优先级与 Pi 无交互提示时一致：没有需要信任资源则正常加载；全局扩展 `project_trust` 决定优先，可请求 `remember` 写入 agent `trust.json`；否则已保存决定优先；最后 `defaultProjectTrust` 的 `always` 加载，`never`/`ask` 跳过（没有浏览器运行时信任弹窗）。

添加项目可显式勾选“信任此项目”，不操作不写决定；工作区菜单可切换“已信任”。服务器解析授权工作区路径，远端保存于远端。下次运行时创建/打开读决定，既有运行时不立即重新加载，`/reload` 保留运行时信任状态。项目 auth/model/preferences 存储不迁入 trust；管理嵌入不读取/写入普通信任 API，继续独立授权资源与沙箱。

<a id="session-daemon-tools"></a>
<a id="session-tools"></a>
### 会话守护进程工具

`spawnSessions` 默认 `true`，提供 `spawn_session`，在同一项目其他工作区发起独立会话，发起后不向父会话回传结果。`subsessions` 默认 `true`，同时要求 `spawnSessions`，提供跟踪子会话工具。子会话始终使用父 cwd，`spawn_subsession` 没有 `cwd`；其他工作区使用独立 `spawn_session`。

跟踪子会话完成会自动通知/唤醒空闲父会话，无需轮询。父会话可继续独立工作，或在 join 点单独调用 `yield_to_subsessions` 作为批次最后动作：仍有工作则结束当前代理运行，没有工作则明确报告且不结束。`list_subsessions`、`check_subsession`、`read_subsession` 用于有意检查，不更改控制流；工作期间隐藏部分输出，完成后输出可用。过长完成结果不重复截断进上下文，指引使用 `check_subsession`。

两种 spawn 都支持精确 `provider/model-id` 的 `model`；未知/错误格式拒绝。省略时继承父模型，思考级别也继承并限制到模型能力。`#provider/model-id` 引用表达用户模型选择，不自动改变当前会话。

`askUser` 默认 `true`，可在 **设置 → 会话守护进程** 切换。问题表单支持 1–20 问，每问最多 12 选项、可选多选、始终可自定义文本，可以不回答。普通消息取消开放表单，新表单替代旧表单；daemon 仍活跃时开放表单可跨浏览器/Web 重启保留。修改开关或升级工具实现需重启 daemon。管理生成子会话仍保留原管理上下文及显式工具拒绝。

<a id="extension-dialogs"></a>
### 扩展对话框

扩展 `ctx.ui.confirm()`/`select()`/`input()` 以内联卡片显示，包括会话启动和运行中工具钩子。支持始终启用，无单独开关；回答走 daemon 独立通道，不经过提示词队列。详见[插件说明](https://pi-web.dev/plugins#pi-extension-dialogs)。

`extensionDialogsTimeoutMs` 默认 `300000`（五分钟），`0` 无限等待，与扩展自己的 timeout 取较早期限。取消值为确认 `false`，选择/输入 `undefined`。全局配置编辑后重启 daemon。

<a id="pi-web-plugin-config-and-recovery"></a>
<a id="plugin-config"></a>
### 插件配置与恢复

`plugins` 控制纯浏览器、纯服务端与双入口的期望启用状态和 JSON 设置，不管理 Pi 包安装。默认启用，包可声明 `defaultEnabled: false`，Captain's Log 如此；显式配置覆盖包默认。必需 `pi-web.terminal` 普通启动不能禁用，设置中不可编辑。服务端设置启动时生效，诊断不暴露设置值。

```json
{
  "plugins": {
    "git": { "enabled": true, "settings": {} },
    "workspace-tasks": { "enabled": true },
    "updates": { "enabled": false }
  }
}
```

保存或换包改变期望状态，不替换运行代码。禁用服务端插件及配套 UI 可在重启前仍运行；包/设置不匹配、健康或兼容异常时暂缓配套 UI。设置区分期望与实际状态，daemon 不可用时实际状态不可用。混合版本不支持，远端插件/Git 可不可用或 404；网关/目标一起升级，重启更新的 Web/API 与目标 daemon 后刷新。不能回退到网关。

顺序：安装/更新目标包 → 保存期望配置 → 纯浏览器刷新；服务端则手动重启目标 daemon、等就绪、再刷新。重启可能中断活跃会话和所有权。仅浏览器刷新、Web/UI 自动重载、Web/API 重启、Pi `/reload` 都不激活服务端变化。

恢复 CLI 离线编辑全局配置，不连接 daemon、不发现/导入包、不带机器凭据；直接在目标机器运行，自定义配置加 `--config /path/to/config.json`：

```bash
pi-web plugins disable <plugin-id> --restart
pi-web plugins safe-start show
pi-web plugins safe-start set bundled-only --restart
pi-web plugins safe-start set none --restart
pi-web plugins safe-start clear --restart
```

`disable` 保存 `enabled: false`，但拒绝必需终端。`bundled-only` 在发现/导入之前过滤外部插件，仍要求终端；`none` 跳过全部服务端插件，保留内核项目目录与诊断/设置，无终端工作流。`clear` 下次恢复普通发现。不支持的 safeStart 形状/值按 `none` 失败关闭，通过 show/set/clear 修复。

`--restart` 只执行识别的安全安装计划，否则打印手动指引。先持久化再重启，服务管理器失败后手动重启。一般失败尽可能隔离，但插件共享 daemon event loop，不是真正崩溃隔离；bundled-only 绕过外部失败，none 连内置失败也绕过，改变后仍需重启。

<a id="keyboard-shortcuts"></a>
<a id="shortcut-config"></a>
### 快捷键

`shortcuts.<actionId>` 值如 `mod+k`、`g p`、`shift+enter`，`null` 禁用该动作。

```json
{
  "shortcuts": {
    "core:view.chat": "mod+1",
    "core:session.stop": null,
    "app.navigation.focus-projects": "g p",
    "composer.send.desktop": "mod+enter",
    "composer.send.mobile": "shift+enter"
  }
}
```

从 **设置 → 键盘** 编辑、录制、禁用或重置。`mod` 为 Ctrl/⌘，浏览器/系统可占用组合。应用支持单键和序列；无修饰键及仅 Shift 的绑定不在 input/textarea/select/contenteditable 内开始。序列 1.2 秒到期，Escape/焦点变化取消；自定义优先，同优先级按 action ID；短绑定遮蔽同前缀长序列。

编辑器发送绑定只接受一个组合。宽度 >760px 默认 Enter；宽度 ≤760px 默认 Shift+Enter，键仍为 `composer.send.mobile`，不因宽屏触控或粗指针改用窄屏规则。未分配 Enter/Shift+Enter 插入换行；普通 Enter 优先接受选中补全。编辑器内发送绑定优先于应用快捷键，空草稿或不可发送时也如此。`null` 禁用键盘提交，不禁用按钮。

对应绑定未配置前保留浏览器旧 Enter 偏好，重置回该回退；不把旧偏好自动复制到共享配置。触屏键盘自动首字母大写不视为 Shift。

<a id="prompt-completions"></a>
## 提示词补全

- 草稿开头 `/` 补全会话命令。参数提示显示在名称旁，选择后一次性灰色提示在下次编辑/移动光标时消失。
- `@` 补全已跟踪文件；`@ `（at 后空格）或 `!@` 补全全部文件。选择插入路径引用，含空格自动加引号。
- `#` 补全当前会话可用模型，不区分大小写，最多 12 项。选择插入 `#provider/model-id`，指引代理使用模型，例如 spawn 的 model 参数。

<a id="completion-tools"></a>
<a id="optional-completion-tools"></a>
## 补全工具

可在服务器 PATH 安装 `fzf` 改善文件补全排序；不安装也能补全，`rg` 用于文件发现。
