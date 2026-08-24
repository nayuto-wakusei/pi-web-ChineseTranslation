# @chainingintention/pi-web-cn

## 1.202608.14

### Patch Changes

- 5065cd5: 按普通模式项目分别保存已启用模型范围，避免一个项目的模型开关在其他项目产生错误警告。
- 5065cd5: 自动续期管理嵌入模式中过期的 Workbench Agent Session，使新建会话和后续能力调用不再复用失效的资源授权。

## 1.202608.13

### Patch Changes

- Retry transient Workbench MCP transport failures once and report actionable connection categories without exposing capability credentials.
- Prevent ordinary-mode enabled model selections from appearing as runtime warnings in management-embed sessions.

## 1.202608.12

### Patch Changes

- db98ead: 普通模式的模型选择器新增“已启用 / 全部模型”视图，可搜索完整模型目录并逐项调整 Pi 的启用模型范围；管理嵌入保持原有只读选择体验。
- dee5884: 修复不同主题下提示编辑器光标不清晰、选区文字难以辨认的问题。
- 027066e: 修复会话清理预览完成后“运行清理”按钮仍被错误禁用的问题。
- 829fac1: 会话模型选择与轮换遵循 Pi 的 `enabledModels` 范围，并提供完整模型目录及普通模式下的逐模型启用接口。
- 05520a1: 在状态 API、命令行版本报告和 Info 插件中显示各 PI WEB 进程实际加载的 Pi SDK 版本，并提示 Web 与会话守护进程之间的版本差异。
- f24d3e6: 在提供商认证和凭据移除列表中增加搜索，支持按名称或 ID 快速筛选。
- e5fadb9: 添加项目时去除路径首尾空格，避免创建或保存带有意外空白的目录。

## 1.202608.11

### Patch Changes

- 27a893c: Store the shared management-embed model configuration alongside its credentials under `$PI_WEB_DATA_DIR/management-embed`.

## 1.202608.10

### Major Changes

- d7d8fd7: 新增工作区 Provider 插件后端、Git 插件化支持和稳定版浏览器插件 API v2，同时保留项目级认证、管理嵌入和审计边界。浏览器插件需要迁移到 API v2；旧版 `plugin-api/unstable` 类型入口不再提供。

### Patch Changes

- 6286ef2: 导航栏中所有展开的机器、项目、工作区和会话区块现在平均共享可用高度。
- 963788a: 将 `ask_user` 回答记录中的完成摘要改为中文，并兼容历史会话中保存的英文摘要。
- c8ce6af: 修复管理嵌入模式提交或取消 `ask_user` 问题时错误回退到普通项目认证的问题。
- 085b6e6: Show mode-appropriate project setup guidance when no projects are available.
- 0f24d25: 增强 `pi-web doctor`、`start` 和 `restart` 的服务就绪性检查，修复 macOS LaunchAgent 重启竞态，并让 Docker 内的会话守护进程恢复操作使用对应的 Docker 控制命令。启用普通模式登录保护时，CLI 会把认证响应识别为 Web 服务在线，但不会把无法读取的运行版本误报为已验证。
- 445ff08: 让 Docker 中的普通模式会话识别容器、持久化目录、宿主机挂载和镜像扩展点，同时继续隔离管理嵌入模式的宿主环境信息。
- 096a232: 为工作区文件增加安全的图片、HTML、PDF 和 Markdown 预览，并以严格类型白名单、沙箱响应策略和流式下载保护本地及远端文件访问。
- e838507: Keep Docker web health checks healthy when ordinary-mode password authentication is enabled.
- e3613e6: Hide the PI WEB brand in the upper-left corner of management embed mode.
- 36cefc6: 新增由 sessiond 按机器、项目和工作区归属计算的实时状态树，保留普通模式与管理嵌入模式的状态隔离，并兼容旧版活动接口。
- b9ade31: 修复嵌入模式创建跟踪子会话时错误使用普通项目注册表的问题。
- b5143ae: Relay 面板现在可以安全浏览嵌套目录中的文档，并通过可折叠目录保留当前文档选择。
- 5251311: 升级内置 Pi 运行时至 0.84，统一项目会话的凭据刷新策略，并保护会话守护进程状态目录不被重复实例同时占用。
- 6328216: 在管理嵌入模式中隐藏 PI WEB 品牌和操作入口，普通模式保持不变。
- 98d7104: 支持从会话树中的任意历史条目分叉为新会话，并以不同色调区分条目类型。
- 1e70579: Unify dialog focus, keyboard, layering, and dismissal behavior, and allow subscription OAuth login and logout for federated remote machines from the gateway UI.
- 5f4c652: 修复加载 bundled Git 插件后工作区工具栏重复显示两个 Git 面板的问题。
- 2802991: 修复项目列表的未读会话标记样式，避免在会话空闲时误显示为正在活动。
- 045b4ad: 默认启用受跟踪的子会话工具；仍可将 `subsessions` 配置项或 `PI_WEB_SUBSESSIONS` 环境变量设为 `false` 来关闭，并继续要求 `spawnSessions` 已启用。升级后需要重启会话守护进程才能应用新的默认值。
- eef9dd9: 修复 session daemon 未将已启用的 `askUser` 配置传入会话运行时，导致 `ask_user` 工具不会注册的问题。
- 4ea9224: 将会话树限定在当前工作区，并让 `spawn_subsession` 始终在父会话工作区创建受跟踪子会话；同时缓存会话列表摘要，避免重复读取未变化的完整会话记录。需要在其它工作区运行时，请改用 `spawn_session` 创建独立会话。

## 1.202608.9

### Patch Changes

- 7d457e6: Include the management-embed user's display name in structured and Elasticsearch audit logs when the integrating project supplies it.
- 7d457e6: 将会话活动栏的 `running` 状态显示为“运行中”。
- 7d457e6: 在管理嵌入模式的 Elasticsearch 审计日志中记录用户提示词、助手回复、工具参数和工具结果。
- 7d457e6: Ensure management-embed projects have a project-local Relay skill without overwriting an existing project version.
- 7d457e6: 修复管理嵌入模式中文件工具无法读取 Python 沙箱所显示的 `/workspace` 路径。

## 1.202608.8

### Patch Changes

- Allow management-embed sessions to use the configured `spawn_session`, tracked subsession, and `ask_user` tools while preserving management context and explicit tool denies.

## 1.202608.7

### Patch Changes

- Add a controlled management-mode integration for network model workbench resource sessions, authorized fixed-version Skills, L0 MCP capability search and calls, and workspace-only sandboxed Python execution. Reuse a single Agent Session when the embedded workbench sends concurrent requests with the same entry ticket. Keep metadata-only service logs for both modes, persist ordinary-mode tool audits in a managed SQLite database, and add CLI commands for querying, exporting, pruning, and compacting those records. Add user-scoped management audit delivery to weekly Elasticsearch indices with monthly one-year retention cleanup.

## 1.202608.6

### Patch Changes

- 6f886a4: 在历史消息和实时消息的助手气泡元数据中，于模型和时间旁显示生成回复时的中文思考级别；思考关闭时保持原样。
- aa16e6f: 将工作区文件操作改为紧凑的图标工具栏，避免操作按钮挤压面板标题。
- 5759201: 支持在浏览器中处理 Pi 扩展对话框：`ctx.ui.confirm()`、`ctx.ui.select()` 和 `ctx.ui.input()` 现在会在会话记录中以内联卡片显示，并返回用户的实际回答。该能力覆盖会话仍在启动时由 `session_start` 钩子打开的对话框，以及运行中的 `tool_call` 钩子对话框。回答通过独立的会话守护进程通道传递，而不进入提示词队列，因此等待回答的 `tool_call` 钩子不会阻塞运行。打开的对话框可在浏览器刷新后恢复；多个标签页中最先提交的回答生效；未回答的对话框会在运行中止、运行时替换或超时后安全结束。新增 `extensionDialogsTimeoutMs` 配置项作为无人处理时的安全超时，默认 5 分钟，设为 `0` 时永久等待。对话框支持始终启用；其他 `ExtensionUIContext` 界面能力（组件、状态、编辑器和 `custom`）仍未实现。
- bfa9794: 修复会话守护进程版本陈旧状态判断，确保守护进程运行版本落后于已安装版本时显示重启提醒。
- a80751f: 将 PI WEB 1.202608.5 要求的会话、通知、文件建议、机器设置和 Pi 包功能视为健康运行时的固定能力。
- c3aeef2: 切换中继文档时保留标签栏的横向滚动位置，避免每次点击标签后都跳回最左侧。
- 72ecf9c: 要求会话 HTTP 请求同时携带会话 ID 和工作区路径，避免不同机器或工作区中的同名会话被错误定位。
- 4da2f2e: 恢复工作区文件面板的新建、下载、移动或重命名及删除操作入口，并支持选中文件夹进行管理。
- 90f22b8: 通过 `spawn_session` 和 `spawn_subsession` 创建的会话现在会继承发起会话的思考级别，并根据子会话模型的能力自动限制该级别，而不再回退到 Pi 的默认值。
- 07b301a: 代理委派任务时现在可以选择模型：`spawn_session` 和 `spawn_subsession` 接受可选的 `model` 参数，其值必须是精确的 `provider/model-id`（未知值会被拒绝，省略时继承当前模型）。在聊天输入框中键入 `#` 会打开模型补全菜单，并将 `#provider/model-id` 引用插入草稿，代理会把该引用作为对应参数传递。
- 670b490: 精简会话列表的批量选择工具栏：未选择时显示“选择可见”，存在选择时显示“清除所选”；移除重复的“完成”按钮，并将操作缩短为“归档”和“删除”，避免工具栏在较窄的侧边栏中换行。

## 1.202608.5

### Patch Changes

- 修复会话列表操作菜单被行级渲染优化裁剪、点击后不可见的问题。
- Restrict management-embed sessions to skills provided by the managed project workspace.

## 1.202608.4

### Patch Changes

- 嵌入模式在建立会话后不再继续携带已过期的入口令牌，避免后台请求被上游拒绝。
- 分批渲染大型会话列表，并减少长对话滚动、屏外内容布局和无关状态更新带来的页面卡顿，同时保留切换会话后的流式回复恢复能力。
- 补全会话清理、信息、中继、提问、会话树、聊天通知、工作区和设置界面的中文文案，并将角色、作用域等协议值映射为中文显示标签。
- 将会话实时活动状态显示为中文。
- 修复嵌入模式创建会话时管理上下文丢失、请求被错误按普通模式处理的问题。
- 模型思考期间，新加入队列的消息会继续显示在对话底部。

## 1.202608.3

### Patch Changes

- 955c863: Keep manually pinned conversations at the top of the session list, including pinned conversation trees.

## 1.202608.2

### Patch Changes

- a8b3ca6: Fix the release smoke test to validate the localized package name.

## 1.202608.1

### Patch Changes

- 9cc09c0: Fix interactive terminals so Bash, Zsh, and Fish load their login profiles.

## 1.202608.0

### Patch Changes

- 9191f59: Add an `ask_user` session tool that lets agents post structured question sets as one chat-native browser form. The form uses the transcript's single scroll area, keeps its header visible, and always gives every question a Custom free-text answer with mobile-safe text sizing. Agents end their run while the form waits; users can submit full or partial answers, unanswered questions are reported explicitly, sending an ordinary chat message voids the open form, pending forms survive browser and web/API reconnects, and closed forms remain readable in the transcript. Disable the tool from **Settings → Session daemon**, with `askUser: false`, or with `PI_WEB_ASK_USER=false`.
- 111db63: Let chat markdown tables keep their natural width and scroll horizontally instead of being squeezed into the chat column, making them readable on mobile.
- 8517800: Turn the bundled Info plugin panel into an always-available PI WEB status view: it now shows the running and installed versions, installation kind and path, release state, per-service health, and machine and workspace details from host-provided status, plus a "Copy PI WEB Diagnostics" action that copies a plain-text summary for bug reports.
- 531ccf7: Let an already-known provider extension refresh its own model list after daemon startup. Previously every provider registration made after the global bootstrap was ignored, so a provider that fetched an updated model catalog on session start never had those models appear. A registration is now applied when it matches the provider's recorded startup configuration in every respect except the model list; anything else — a new provider, a changed provider base URL, API key, API type, headers, or auth surface, a native provider registration, or an unregistration — is still ignored to keep project-level provider configuration from leaking between workspaces. Documented the refreshed policy under Pi extension provider baseline in the configuration reference.
- ce4b469: Add action-palette commands for selecting a session's model and thinking level, with support for assigning custom shortcuts in Settings.
- 69b125b: Show cross-workspace session relationships in the session list. A session whose parent lives in another worktree now names that parent's workspace or branch instead of only reporting an unavailable parent, and offers a "Go to parent session" action that switches to the owning workspace and selects the parent. A session with children in other workspaces of the same project now shows how many, so a parent no longer looks childless when its children are not nested beneath it.
- d19fca4: Add `files.listFiles(path)` to the stable plugin API so workspace panel and label plugins can list workspace directory entries on local and federated machines.
- 8517800: Add `state.selectedMachine` to the stable plugin runtime state so plugin actions and other runtime callbacks can read the selected machine's identity, not just workspace panel contexts.
- 87c0998: Add a built-in Relays plugin: a read-only workspace tab (and **Open Workspace Relays** action) that browses `.pi-web/relays/` packets, with a most-recent relay picker, ordered document tabs, sanitized markdown rendering, and truncation notices.
- 5c3461d: Remove the legacy session archive migration from session daemon startup. Each `PI_WEB_DATA_DIR` data directory is independent: pointing PI WEB at a new data directory starts there with empty registries and no session archives.

  You are only affected if you have session archives created before July 2026 in the default `~/.pi-web` data directory and you newly set a custom `PI_WEB_DATA_DIR`. To carry those archives over, stop PI WEB, then copy `archived-sessions.json` and the `archived-sessions/` directory from the old data directory into the new one.

- 76f292c: Stop the session and workspace lists from re-scrolling to the selected row on live data refreshes, such as message-count updates while a session streams or workspace topology refreshes. The lists now scroll the selection into view only when the selection moves to a different row, an archived session is revealed, a restored session moves back to the current section, or a collapsed section expands.
- 49e7c39: Say what a slow session start is waiting on. While a session is being created or opened, the activity line now names the current startup step — starting the Pi session, or loading session extensions — and adds a note when provider model lists happen to be refreshing at the same time. When nothing can be attributed, the previous generic wording is kept rather than guessing a cause.
- 8af637b: Give every navigation row a single activity indicator that also carries unread state. When sessions beneath a workspace, project, or machine row have unread completions, the row's indicator becomes a static accent ring around the activity dot — or a filled accent dot while idle — instead of a separate dot next to the name. Session rows now surface unread state even while busy or sending, and the "N unread" header and mobile Sessions badge count busy unread sessions too.
- 8af637b: Add "Mark as read" actions for unread sessions: a per-session item in the session row ⋯ menu (shown only for unread sessions) and a bulk "Mark read" button in the multi-select bar that marks every unread selected session as read.
- 4a51503: Add copy buttons to the workspace menu details so the workspace path and branch can be copied to the clipboard with one click, matching the copy affordances already available in chats.
- 8a24a7c: Pick up git worktrees created or removed outside PI WEB without any user action. The selected project's workspace list is re-read whenever the browser tab regains focus or becomes visible, on local and remote machines, keeping the current workspace, session, and scroll position untouched. Worktrees whose checkout directory no longer exists are hidden instead of being offered as selectable workspaces.

## 1.202607.11

### Patch Changes

- 9ed189d: 恢复 Web 应用重新挂载后的实时连接，并阻止会话守护进程在会话关闭后发布迟到状态。
- 9ed189d: Restore model selection and project-scoped login compatibility with Pi 0.82.
- d4021df: Restore the description for the highest thinking level in the session picker and clarify the ordinary-mode login prompt.
- d4021df: Add message-level session content search with multi-match highlights, direct navigation to matching messages, and a search entry that remains available in narrow layouts.
- 9ed189d: 加入正在运行的旧会话时立即衔接进行中的回复和工具执行结果，无需等待当前回合结束。

## 1.202607.10

### Patch Changes

- 修复点击终端按钮后终端区域错误占满页面的问题。

## 1.202607.9

### Patch Changes

- 在管理嵌入模式中将会话清理限制为当前项目的工作区，普通模式保持原有清理范围。

## 1.202607.8

### Patch Changes

- b20033b: 为会话导航栏增加全文搜索和手动置顶，并将置顶状态持久化到服务端，支持普通模式和管理嵌入模式的工作区隔离；会话列表会定期刷新并按最近更新时间实时重新排序。

## 1.202607.7

### Patch Changes

- 7cbbc04: 按模式与项目隔离会话偏好默认值（思考级别与默认模型）。会话继续读取真实 agent 的 packages/extensions 等共享配置，避免首次打开会话后冻结全局 package 列表。

## 1.202607.6

### 认证与运行时

- 按项目隔离普通模式的 `auth.json` 和 `models.json`；项目首次使用时从全局 Pi 配置迁移初始副本，之后独立管理提供商凭据与自定义模型。（4d08c74）
- 将项目认证、OAuth、模型刷新和会话创建整体迁移到 Pi `ModelRuntime`，并修复管理嵌入模式的跨站会话与流式重连。（14e911d）
- 增加可选择的 Pi 兼容 Agent Profile 及配套 CLI，隔离认证、模型、设置、会话、Pi 包、插件和诊断环境。（75e2377）

### 会话与交互

- 支持从会话菜单重命名已持久化且未归档的对话。（4d973e1）
- 增加“清空队列”操作，可移除普通排队消息以及压缩期间暂存的提示，不会中断正在执行的任务。（a1f749c）
- 在标准聊天卡片中保持工具结果图片可见，同时保留执行细节与最终消息元数据。（f181c47）
- 增加可跟踪子会话的显式 yield 机制、无轮询唤醒指引和剩余子任务状态。（d5154df）

### 部署与运维

- 同一份前端构建同时支持根路径和嵌套反向代理部署，覆盖 PWA 资源、WebSocket 以及本地/远程插件路径。（a493949）
- 在本地或联邦机器上增加强制刷新的“检查 PI WEB 更新”操作。（d72b14f）
- 改进 systemd/launchd 安装与诊断，在真实服务管理器环境中验证依赖、PATH 和清理行为。（dde48b3）
- 当显式配置 `PI_WEB_DATA_DIR` 时，将归档索引与归档会话文件存放到该目录，并在条件完整且目标干净时安全迁移旧归档。（ec0ca13）
- PI WEB 创建的终端 Shell 会设置 `PI_WEB_TERMINAL=1`，便于子进程识别运行环境。（73ac24c）
- 以浏览器兼容的 Content-Type 提供 PI WEB 插件 SVG 资源，并明确模块相对资源的打包方式。（21c58fe）

## 1.202607.5-dev.0

### Patch Changes

- cfcd4f8: Fix long conversations so the chat scrollbar can reach the complete bottom of the transcript.

## 1.202607.5

### Patch Changes

- 12618f7: Protect management access tokens in request logs, throttle password and Bearer login failures, stop native services before global npm upgrades, handle optional task configuration without failed requests, return correct missing-resource responses, and finish Chinese UI metadata and accessibility labels.

## 1.202607.4

### Patch Changes

- d6cfffd: Allow chat copy buttons to work from HTTP private-network addresses by falling back when the browser Clipboard API is unavailable.
- 856ba73: Include Vim in the default Docker runtime and development images.
- 3df4041: Manage Pi packages from Settings on the selected PI WEB machine, including federated remote machines, while keeping gateway-local Settings scopes clear.
- 829b350: Fix the Docker runtime installer so one-line installs can fetch Docker assets into a fresh install directory.
- 3cb81b1: Improve session-start feedback so concurrent new sessions stay visible without disrupting session-list navigation.
- ad62853: Show full chat tool file paths and commands in horizontally scrollable headers, repeat them in expanded tool details, and keep result output horizontally scrollable.
- eb17276: Preserve archive and archived-session delete actions for older federated PI WEB machines that do not yet advertise session persistence or delete capabilities.
- 8ade238: Add PI WEB settings for managing Pi packages separately from PI WEB plugin enablement, including install/remove/update flows and browser/session reload guidance.
- c9ad5b0: Keep ordinary-mode authentication primary actions readable on accent backgrounds.
- 386c67e: Raise the minimum supported Pi version to 0.80, removing reliance on Pi's deprecated `pi-ai` compat API for session-name generation in favor of the stable `pi-agent-core` streaming interface.
- 10efb7f: Name Relay handoff sessions deterministically from their relay name and leg number.
- 0b17b9d: Promote the Updates tab to stable by removing its beta label while keeping update message counts visible.
- 0a1b7f9: Keep gateway Settings panels responsive while selected-machine Pi packages load or fail separately, report Pi package-management support through runtime capabilities, guide remote Pi package-management UI when support is known unavailable, and serialize Pi package mutations to avoid concurrent settings/install-root races within a PI WEB server process.
- 64b2b32: Make Settings edit machine-scoped PI WEB config on the selected machine for session daemon tools, plugin enablement, external path access, and upload defaults while keeping gateway/browser-only settings local, and show those forms as unavailable when a remote machine does not advertise support.
- d2e10cd: Show the random-looking suffix for unnamed sessions so newly created empty sessions are easier to distinguish.
- 889672f: Add `/reload` support for PI WEB sessions so installed Pi package resources can be refreshed in existing sessions without restarting the session daemon, while keeping browser plugin reload guidance separate.
- 2665d1e: Create editable chats immediately when starting sessions, open the chat right away on mobile, queue sends until the backend session is ready, reconcile concurrent session-created broadcasts, and use server-backed persistence signals for session archive/delete/reload actions.
- b61a9c0: Standardize Settings tabs so descriptions, notices, and controls render in a consistent order, with unavailable remote settings hiding blocked controls.

## 1.202607.3

### Patch Changes

- a551d60: Add a normal mode password gate with first-run setup, login, and password changes from the action palette.

## 1.202607.3-beta.0

### Patch Changes

- Keep management-embed session actions, credentials, realtime events, and sandbox permissions isolated from normal PI WEB sessions.

## 1.202607.2

### Patch Changes

- 6ff3f23: Restore the workspace file download button so selected files can be downloaded from the file panel.

## 1.202607.1

### Patch Changes

- 5310299: Fix management embed workspaces so authorized project directories are created before the workspace file tree loads.

## 1.202607.0

### Patch Changes

- d165d69: Improve bulk session archive and delete reliability by adding true bulk mutation support for large session selections.

## 1.202606.27

### Patch Changes

- e4b5229: Translate session cleanup dialog, sidebar button, command action, validation, and confirmation copy into Chinese.
- 93ad68c: Add workspace file panel actions for creating files, creating folders, and deleting the selected path.

## 1.202606.26

### Patch Changes

- 17f2175: Avoid creating managed project directories while loading read-only management embed project and workspace views.
- a874798: Make spawned and tracked subsessions inherit the dispatching session's current model instead of falling back to the last globally selected model.
- 2009e6a: Keep the chat prompt input stable during streaming so mobile touch gestures (such as the iOS long-press paste/edit callout) are no longer interrupted. Session status and activity updates are now coalesced into a single render per animation frame instead of one per token, the prompt editor ignores status changes that do not affect what it displays, and per-keystroke draft state no longer triggers surrounding re-renders.
- 7063c2c: Prevent iOS Safari from zooming into small text inputs across the web UI.

## 1.202606.25

### Patch Changes

- 8f278cf: Improve web client API parsing for PI WEB status and machine runtime responses.

## 1.202606.24

### Patch Changes

- 14acefe: Prevent management embed sessions from loading global AGENTS.md or CLAUDE.md context files while preserving project-local context files.
- 14acefe: Fix management embed session recovery for localized missing-session errors and keep model/thinking-level controls in the managed runtime context.

## 1.202606.23

### Patch Changes

- Restore the management embed sandbox policy so managed Pi sessions expose only restricted file tools and Python, while shell, terminal, MCP, and HTTP tools stay denied.

## 1.202606.22

### Patch Changes

- c1ae62b: Sandbox ordinary Pi session tools in management embed mode and fail closed when the host cannot start the managed shell sandbox.

## 1.202606.21

### Patch Changes

- 888b9ce: Run management embed command executions inside a bubblewrap workspace sandbox instead of the host shell.

## 1.202606.20

### Patch Changes

- Reduce shared client/server code bloat by splitting large shared modules into focused config, session, chat, and UI helpers while preserving runtime behavior.

## 1.202606.19

### Patch Changes

- d422a57: Constrain the desktop app shell and chat viewport so the page itself does not scroll long conversations out of view.

## 1.202606.18

### Patch Changes

- eaf5f72: Fix the main web layout so long chat histories no longer push the prompt editor below the visible viewport.

## 1.202606.17

### Patch Changes

- d95dc10: Keep the chat composer visible at the bottom of the session view instead of letting long conversations push it below the viewport.

## 1.202606.16

### Patch Changes

- 6df7266: Restore the chat composer when a selected session is reopened in the stacked workspace layout, so the prompt box no longer disappears after returning from workspace tools.

## 1.202606.15

### Patch Changes

- 62c2234: Prevent live skill-loading cards from duplicating when the finalized transcript groups multiple skill reads.
- 27bc924: Persist the Settings 鈫?Session daemon tracked subsessions toggle so it remains enabled after restart.
- d931101: Fix dead-key/IME input in the terminal (e.g. typing `~` on a Swedish keyboard). The character previously stuck in the top-left corner and was never sent to the shell. The terminal panel now includes the xterm composition-view styles and no longer forces the helper textarea's position with `!important`, so dead-key composition is placed at the cursor and committed correctly.
- 355ebe8: Add tracked subsessions (beta, off by default): agents can spawn child sessions they stay attached to. The new `spawn_subsession` tool starts a child session linked to its parent (recorded in the session tree), notifies the parent when the child stops working, and lets the parent inspect children via `list_subsessions`, `check_subsession` (a quick glance at a child's status and latest output), and `read_subsession` (read through a child's transcript with role/content filters, full-content substring search, optional per-value `maxChars` truncation that flags clipped parts, and pagination). The completion notice is delivered as a system-authored message (not attributed to the human), and still wakes an idle parent while queueing behind any in-flight work. Unlike the fire-and-forget `spawn_session`, subsessions are observable by their spawner.

  The capability is gated behind a beta flag so it can ship without being exposed in releases: enable it with the `PI_WEB_SUBSESSIONS` env var, the `subsessions` config key, or the "Allow agents to start tracked subsessions" toggle in Settings 鈫?Session daemon. It also requires `spawnSessions` to be enabled. Requires a manual session daemon restart to take effect.

## 1.202606.14

### Patch Changes

- Allow the Updates panel copy and run buttons to work in management embed sessions.

## 1.202606.13

### Patch Changes

- Localize remaining web UI and command messages into Chinese.
- Require locally signed PI WEB management embed tokens and reject legacy introspection configuration.

## 1.202606.12

### Patch Changes

- 53b00c4: Show a per-session sending indicator while messages with image attachments are uploading. Previously the composer cleared instantly while the upload, server-side image resizing, and first-session open happened in the background, so it looked like nothing was happening. The chat activity dock now shows "Sending your message…" for the originating session (including the folder-mode upload step), and that session shows the activity dot in the session list so progress is visible even after switching away. The indicator is scoped per session, so it no longer leaks onto other sessions or machines, and the upload itself continues in the background regardless of navigation.
- 65addad: Restore Chinese UI text after the upstream merge, constrain inline chat images so they no longer overlap messages, and keep the file upload control as a single Chinese button.
- cfb7493: Improve user/assistant message distinction in the dark theme. Previously the user and assistant message backgrounds were nearly identical (contrast ratio ~1.06), making it hard to tell speakers apart. Each message now has a colored left accent stripe by role (brand accent for user, neutral for assistant) with matching header labels, applied across all themes. The dark theme's user-message background was also lightened and decoupled from the generic hover color, and the user border brightened, so user turns stand out clearly.
- 411e61a: Declutter the chat composer bar with icon-based actions. The Send, Queue, Steer, and Stop buttons are now compact icons, the Attach button moved into the message box, and the thinking level is shown as a small gauge whose bars reflect the levels available for the current model. This leaves more room on narrow/mobile layouts while keeping the model selector readable. All controls retain accessible labels and tooltips. Thinking levels are now sourced from pi directly, so an unfamiliar level from a newer pi version is still selectable and displayed gracefully instead of causing an error.
- d17050e: Add image attachments to the chat composer. You can now paste (Ctrl/Cmd+V), drag-and-drop, or use the new Attach button to add PNG, JPEG, GIF, and WebP images to a message, with thumbnail previews and multi-image support. Attachments are delivered to the session using pi's native image format (images are auto-resized to pi's inline limits for full compatibility), and image content now renders inline in the transcript. A per-message delivery toggle also lets you instead save attachments into the workspace `.pi-web/paste` folder and reference them so the agent reads them with its own tools. The accepted HTTP upload size is now configurable via `PI_WEB_MAX_UPLOAD_BYTES` or the `maxUploadBytes` config value.
- 3c6b4a4: Run the suggested Linux restart commands inside a detached transient systemd user service (`systemd-run --user`) instead of directly. The restart now completes even when the launching PI WEB terminal is killed by restarting the session daemon, and its output can be inspected with `journalctl --user -u pi-web-restart`.
- 82db15f: Add a **Reload** action to the session three-dot menu that re-reads the session from disk. The session daemon keeps an in-memory `SessionManager` per session and never re-reads the session file, so when the same session is also driven by another process (for example the `pi` CLI), new on-disk entries were invisible to the web UI and the tail of the conversation appeared truncated. Reloading closes the active session, re-opens it from disk, discards the cached transcript, and re-fetches the history.

  Reload is also available from the command palette as **Reload Session**, so it can be triggered from the keyboard and assigned a custom shortcut. Reload refuses to run while the session has work in progress and on archived (read-only) sessions, and is gated behind a new `sessions.reload` runtime capability so it only appears for machines whose Pi-Web runtime supports it (both the menu item and the palette action are disabled otherwise).

  Note: this changes a session daemon code path, so `pi-web-sessiond.service` must be restarted manually for the server side of this change to take effect.

- 3c6b4a4: Make the Updates panel actionable: every suggested command now has both a Copy and a Run button (Run executes it in a workspace terminal), a single recommended all-in-one command is shown at the top so users do not have to choose, and the remaining commands are grouped as clearly optional additional commands.

## 1.202606.11

### Patch Changes

- 4b821c6: Add image attachments to chat prompts for Pi models that support image input.

## 1.202606.10

### Patch Changes

- Support large local workspace file uploads with streamed transfer, and disable the upload action for remote machines until remote uploads support the same flow.

## 1.202606.9

### Patch Changes

- Translate newly added command palette actions and live activity status labels into Chinese.

## 1.202606.8

### Patch Changes

- 15cba02: Replace management embed remote introspection with locally verified signed tokens and a 24-hour server-side management session.

## 1.202606.7

### Patch Changes

- Create a default management-embed project for the logged-in user when the platform session has no authorized projects yet.

## 1.202606.6

### Patch Changes

- a73bceb: Reduce desktop navigation crowding by moving machine switching into a compact header control and removing automatic desktop section collapse.
- 9a3f2ce: Make navigation sections collapsible on desktop and auto-collapse completed context sections after selections.
- 271c990: Document machine federation across the website and add a Fleet guide for setup, trust model, remote plugins, and troubleshooting.
- 351ed03: Add a keyboard shortcuts settings editor with manual entry, recording, disabling, reset-to-default controls, and conflict/shadowing indicators.
- f7eff88: Make the app refresh control perform a full page reload directly instead of opening refresh-data options.
- ad963a2: Simplify the mobile location breadcrumb by hiding the machine crumb when there is only one configured machine and removing activity indicators from breadcrumb items.
- f3e19d1: Add keyboard-first navigation for focusing Machines, Projects, Workspaces, Sessions, and the chat composer.
- b35ce1d: Reduce repeated machine and workspace details in the chat status bar and workspace tool header, keeping compact session metrics right-aligned.
- 25d8188: Keep the documentation site's GitHub and theme controls visible in mobile portrait layouts.
- 058fdee: Clarify plugin docs and website copy around private PI WEB APIs and the supported helper surface.
- b616684: Add draggable, persistent side panel resizing for the web UI navigation and workspace panels, including reset actions.
- b2a7975: Align the desktop machine badge status to the right edge of the badge.
- f501f9d: Pin navigation activity indicators to the top-right of list chips so active projects, workspaces, and sessions no longer shift their labels.
- 2f72169: Add workspace file management actions in the file panel, with server-side path checks that keep uploads, moves, deletes, new files, new folders, and downloads inside the selected workspace. Downloads also work from the management embed entry point.

## 1.202606.5

### Patch Changes

- 210cc0e: Harden management embed sessions by running Python through a bubblewrap sandbox when available, falling back to a restricted managed Python runner on hosts that block bubblewrap namespaces, removing inherited host secrets from managed tool environments, and blocking managed terminal command runs.

## 1.202606.4

### Patch Changes

- 709854c: Hide the core terminal entrypoints when PI WEB is opened in management embed mode.

## 1.202606.1

### Patch Changes

- 93b50e6: Replace add-machine browser prompts with a PI WEB form that asks for the remote URL first, suggests a machine name, and supports an optional bearer token.
- 08f69d0: Document built-in PI WEB plugins, including configuration guidance for Workspace Tasks.
- Translate bundled plugin display text into Chinese.
- Document this fork as a Chinese translation plan for PI WEB plugin display content.
- 159f533: Fix workspace selection in the web UI so local machine project and session loading no longer fails with `api is not defined`.
- ccd4a76: Hide the Machines navigation section when only one machine is configured, align Machines list spacing with the other navigation sections, and add a remove action to remote machine rows.
- 193c9d0: Show machine activity indicators when sessions or terminals are active on any workspace for that machine.
- b5f8810: Add machine-scoped local project, workspace, file, and git API aliases as the next step toward machine federation.
- 4495a26: Make the mobile Actions entry available from the top context controls and remove the redundant PI WEB navigation header on mobile.
- 4548e5c: Use compact icons, initials, and inline badges for the mobile main tab bar so tabs are easier to fit without losing horizontal scrolling; let workspace panel plugins provide custom SVG tab icons; and add icons for bundled Info, Updates, and Tasks plugin panels.
- e352dce: Fall back to the local machine when a bookmarked or restored remote machine is offline, and clear stale remote workspace route state.
- bd8d1f1: Keep workspace tool tab icons visible in the desktop workspace panel and collapse tab names only in compact panel widths.
- 08f69d0: Add plugin enablement settings so discovered PI WEB plugins can be disabled before the browser imports them.
- e3533eb: Add documented plugin context helpers for machine-scoped workspace files and terminal commands, generate plugin API declarations from source, and move bundled plugins away from direct PI WEB API calls.
- 8cd2bba: Keep the PWA refresh control menu visible above mobile tab navigation and workspace tab content.
- b3bb732: Remember each machine's last selected project, workspace, session, and workspace tool when switching machines in the web UI.
- a142f5e: Add remote machine federation so PI WEB can register trusted remote runtimes and proxy their projects, workspaces, sessions, files, git state, activity, and terminals through the current web server.
- f1c8f1f: Clean up the workspace panel plugin context by removing the legacy `openTerminal` alias and moving render invalidation to `context.host.requestRender()`.
- 4495a26: Add a deep-linked Settings UI for editing the active PI WEB config file and viewing registered keyboard shortcuts.
- a58c211: Add shortcut preferences to the PI WEB config schema so keyboard shortcuts can be overridden or disabled by action id.
- 0405b38: Add the first machine registry API and show the synthesized Local machine in the web UI as the foundation for machine federation.
- be02c35: Rename the built-in Updates plugin id from `pi-web` to `updates` for clearer plugin configuration.
- 08f69d0: Prevent redundant Workspace Tasks panel re-renders from resetting mobile scroll position or replacing task buttons mid-click, and show feedback for stale, cancelled, or already-starting tasks.
- 08f69d0: Bundle Workspace Tasks with PI WEB as a built-in plugin for running `.pi-web/tasks.json` commands in workspace terminals.

## 1.202606.7

### Patch Changes

- b17faeb: Improve chat, prompt, and session text rendering for RTL and mixed-direction content.
- 7e812aa: Allow chat composer attachments to save and mention general files while preserving native inline image delivery for supported image-only batches.
- 47c9b66: Fix `pi-web doctor` "can find npm/pi" checks on fish. The `--version` check
  wrapped the version command in a POSIX subshell `(cmd --version 2>&1 || true)`,
  which fish parses as a command substitution in command position and rejects
  (`command substitutions not allowed in command position`), producing a false
  negative. Emit fish's `begin; ...; end` grouping when the service shell is fish.
- b14205e: Highlight within-line changes in the Git diff viewer.
- cb13af4: Add a manual sessions cleanup flow that previews and confirms archiving idle sessions and deleting old archived sessions, with per-project selection and capability guidance for unsupported machines. Actions can now expose disabled reasons so unavailable remote-machine actions stay visible with an explanation.
- e46d9ec: Add manual Files panel uploads with direct drag/drop, an options flow from the Upload button, safe non-overwrite defaults, visible per-file progress/error reporting with clear failed/cancelled terminal states, and project-local default destinations.
- 32ea809: Add a Keyboard shortcuts setting for choosing whether Enter sends chat messages or inserts new lines in this browser, with Shift+Enter performing the opposite action when supported, while preserving the desktop-vs-mobile default (desktop Enter sends; mobile/coarse/narrow Enter inserts a new line).
- a99696b: Persist tracked subsession links in session history so parents can list, check, and read child sessions after the session daemon restarts, and reopened children can resume parent notifications.
- 27a3b2b: Add workspace file mutation (`files.writeFile`, `files.deleteFile`, `files.moveFile`) and prompt editor (`prompt.insertText`, `prompt.getText`, `prompt.getSelection`) APIs to the plugin system. File mutations work for local and federated machines, enforce workspace path safety, and auto-refresh the File Explorer.
- 9980027: Expose the plugin prompt editor helper in workspace panel contexts so panel interactions can insert text into the current prompt.

## 1.202606.6

### Patch Changes

- c479a0d: Fix the session daemon startup when PI WEB runs with compatible Pi packages that moved legacy provider registry exports to the Pi AI compatibility entrypoint.

## 1.202606.5

### Patch Changes

- c2e2a29: Add a dedicated PI WEB configuration reference covering config-file precedence, project-local config, external path access allowlists, session daemon tools, plugins, shortcuts, upload limits, and environment variables. Custom `pi-web install --config` paths are now passed to the session daemon service as well as the web service, and the session daemon now honors config-file `maxUploadBytes` values.
- 4f4c6fa: Fix remote session reloads so they proxy through the web/API instead of returning the app shell as JSON.
- 62c2234: Prevent live skill-loading cards from duplicating when the finalized transcript groups multiple skill reads.
- 27bc924: Persist the Settings → Session daemon tracked subsessions toggle so it remains enabled after restart.
- d931101: Fix dead-key/IME input in the terminal (e.g. typing `~` on a Swedish keyboard). The character previously stuck in the top-left corner and was never sent to the shell. The terminal panel now includes the xterm composition-view styles and no longer forces the helper textarea's position with `!important`, so dead-key composition is placed at the cursor and committed correctly.
- 6933d3a: Keep mobile navigation on the selected session when remote workspace loading finishes out of order.
- 2bb6e48: Normalize allowed external path suggestions on Windows so configured absolute paths use platform separators consistently.
- 9cc20d6: Allow configured external filesystem roots to be listed, read, configured from the global settings UI, and completed from absolute `@` path suggestions while keeping absolute paths denied by default, advertise workspace-scoped file suggestion support as a remote-machine capability, and use `fzf` when available to improve file/path completion filtering.
- 355ebe8: Add tracked subsessions (beta, off by default): agents can spawn child sessions they stay attached to. The new `spawn_subsession` tool starts a child session linked to its parent (recorded in the session tree), notifies the parent when the child stops working, and lets the parent inspect children via `list_subsessions`, `check_subsession` (a quick glance at a child's status and latest output), and `read_subsession` (read through a child's transcript with role/content filters, full-content substring search, optional per-value `maxChars` truncation that flags clipped parts, and pagination). The completion notice is delivered as a system-authored message (not attributed to the human), and still wakes an idle parent while queueing behind any in-flight work. Unlike the fire-and-forget `spawn_session`, subsessions are observable by their spawner.

  The capability is gated behind a beta flag so it can ship without being exposed in releases: enable it with the `PI_WEB_SUBSESSIONS` env var, the `subsessions` config key, or the "Allow agents to start tracked subsessions" toggle in Settings → Session daemon. It also requires `spawnSessions` to be enabled. Requires a manual session daemon restart to take effect.

## 1.202606.4

### Patch Changes

- 53b00c4: Show a per-session sending indicator while messages with image attachments are uploading. Previously the composer cleared instantly while the upload, server-side image resizing, and first-session open happened in the background, so it looked like nothing was happening. The chat activity dock now shows "Sending your message…" for the originating session (including the folder-mode upload step), and that session shows the activity dot in the session list so progress is visible even after switching away. The indicator is scoped per session, so it no longer leaks onto other sessions or machines, and the upload itself continues in the background regardless of navigation.
- cfb7493: Improve user/assistant message distinction in the dark theme. Previously the user and assistant message backgrounds were nearly identical (contrast ratio ~1.06), making it hard to tell speakers apart. The dark theme's user-message background was lightened and decoupled from the generic hover color, and the user border brightened, so user turns stand out clearly.
- dd23b3e: Fix a duplicate session appearing in the list when starting a new session. The `session.created` broadcast (added with the spawn_session tool) could race ahead of the start request's HTTP response in the same tab, leaving two badges with the same id — one with archive/reload actions and one with delete. The optimistic insert now replaces any entry the broadcast added, so the locally cached session (with its delete action and draft support) always wins.
- 3930505: Fix the "Catching up…" badge sometimes staying visible after a session goes idle. The stream catch-up mode was tracked by two fields that could drift — a private guard and the public badge flag — and the socket reconnect path updated one without the other, so the terminating idle status no longer cleared the badge. Both facets now route through a single source of truth, and any idle status for the selected session reliably dismisses the badge.
- 411e61a: Declutter the chat composer bar with icon-based actions. The Send, Queue, Steer, and Stop buttons are now compact icons, the Attach button moved into the message box, and the thinking level is shown as a small gauge whose bars reflect the levels available for the current model. This leaves more room on narrow/mobile layouts while keeping the model selector readable. All controls retain accessible labels and tooltips. Thinking levels are now sourced from pi directly, so an unfamiliar level from a newer pi version is still selectable and displayed gracefully instead of causing an error.
- d17050e: Add image attachments to the chat composer. You can now paste (Ctrl/Cmd+V), drag-and-drop, or use the new Attach button to add PNG, JPEG, GIF, and WebP images to a message, with thumbnail previews and multi-image support. Attachments are delivered to the session using pi's native image format (images are auto-resized to pi's inline limits for full compatibility), and image content now renders inline in the transcript. A per-message delivery toggle also lets you instead save attachments into the workspace `.pi-web/attachments` folder and reference them so the agent reads them with its own tools. The accepted HTTP upload size is now configurable via `PI_WEB_MAX_UPLOAD_BYTES` or the `maxUploadBytes` config value.
- 3c6b4a4: Run the suggested Linux restart commands inside a detached transient systemd user service (`systemd-run --user`) instead of directly. The restart now completes even when the launching PI WEB terminal is killed by restarting the session daemon, and its output can be inspected with `journalctl --user -u pi-web-restart`.
- 61f0b79: Move reload to the end of the session action menu.
- 82db15f: Add a **Reload** action to the session three-dot menu that re-reads the session from disk. The session daemon keeps an in-memory `SessionManager` per session and never re-reads the session file, so when the same session is also driven by another process (for example the `pi` CLI), new on-disk entries were invisible to the web UI and the tail of the conversation appeared truncated. Reloading closes the active session, re-opens it from disk, discards the cached transcript, and re-fetches the history.

  Reload is also available from the command palette as **Reload Session**, so it can be triggered from the keyboard and assigned a custom shortcut. Reload refuses to run while the session has work in progress and on archived (read-only) sessions, and is gated behind a new `sessions.reload` runtime capability so it only appears for machines whose Pi-Web runtime supports it (both the menu item and the palette action are disabled otherwise).

  Note: this changes a session daemon code path, so `pi-web-sessiond.service` must be restarted manually for the server side of this change to take effect.

- 95c1512: Let agents start new sessions with a `spawn_session` tool. An agent can dispatch a fresh, independent session with an initial prompt — useful for ralph-style loops (an agent kicks off the next iteration when done) and for chaining long plans across sessions. Spawned sessions are normal sessions a human can open and interact with, and they now appear in the session list the moment they are created (in the matching workspace) without a manual reload.

  To keep every spawned session visible and controllable, an agent may only spawn into a workspace — any worktree, including one it just created — of the same registered project as the spawning session. The capability is on by default and can be toggled under Settings → Session daemon (or via the `spawnSessions` config key / `PI_WEB_SPAWN_SESSIONS` environment variable); changes take effect after the session daemon restarts.

  Note: this adds a session daemon code path, so `pi-web-sessiond.service` must be restarted manually for the server side of this change to take effect.

- 3c6b4a4: Make the Updates panel actionable: every suggested command now has both a Copy and a Run button (Run executes it in a workspace terminal), a single recommended all-in-one command is shown at the top so users do not have to choose, and the remaining commands are grouped as clearly optional additional commands.

## 1.202606.3

### Patch Changes

- c0d1222: Fix sessions outside the server's launch directory being invisible: listing returned no sessions and opening them failed with 404 "Session not found", leaving the model picker empty. Working directories are now normalized at the API boundary and when reading stored session data, so path differences (trailing slashes, redundant segments, and Windows backslash vs forward-slash forms) no longer hide live or archived sessions. Requests with a relative `cwd` are now rejected with a 400 error instead of being resolved against the server's own working directory. Requires Pi coding agent SDK 0.78.0 or newer.
- 38cf334: Restart the web/UI services before the session daemon in the suggested "Restart all" command and `pi-web restart`, so running the command from a PI WEB terminal still restarts the UI even though restarting the session daemon kills the terminal.

## 1.202606.2

### Patch Changes

- 824b7a0: Initialize Pi extensions for web-managed sessions so `session_start` handlers, extension resources, and startup-dependent tools run correctly.
- a73bceb: Reduce desktop navigation crowding by moving machine switching into a compact header control and removing automatic desktop section collapse.
- 9a3f2ce: Make navigation sections collapsible on desktop and auto-collapse completed context sections after selections.
- 271c990: Document machine federation across the website and add a Fleet guide for setup, trust model, remote plugins, and troubleshooting.
- 351ed03: Add a keyboard shortcuts settings editor with manual entry, recording, disabling, reset-to-default controls, and conflict/shadowing indicators.
- 65b4c76: Let Firefox copy only the selected chat text instead of replacing selections with the full message.
- d66eccc: Keep all-file prompt suggestions active while typing file names with spaces, and include git-tracked/untracked matches when broad all-file scans miss them.
- f7eff88: Make the app refresh control perform a full page reload directly instead of opening refresh-data options.
- ad963a2: Simplify the mobile location breadcrumb by hiding the machine crumb when there is only one configured machine and removing activity indicators from breadcrumb items.
- f3e19d1: Add keyboard-first navigation for focusing Machines, Projects, Workspaces, Sessions, and the chat composer.
- b35ce1d: Reduce repeated machine and workspace details in the chat status bar and workspace tool header, keeping compact session metrics right-aligned.
- c57f24d: Allow PI WEB plugins to mark themselves as machine-specific so the gateway copy stays local-only and remote machines can provide their own status/plugin UI.
- 25d8188: Keep the documentation site's GitHub and theme controls visible in mobile portrait layouts.
- ef22247: Keep the selected remote machine during transient reconnects instead of switching the web UI back to Local.
- 0118e6e: Keep archived parent sessions visible in the current session tree while they still have unarchived children.
- 058fdee: Clarify plugin docs and website copy around private PI WEB APIs and the supported helper surface.
- b616684: Add draggable, persistent side panel resizing for the web UI navigation and workspace panels, including reset actions.
- 06052ea: Respect Pi session directory settings in pi-web sessions, including project-local Pi settings, while allowing cwd-scoped session operations without breaking legacy id-only routes.
- b2a7975: Align the desktop machine badge status to the right edge of the badge.
- a3b5b72: Add safe bulk session actions for archiving current sessions and permanently deleting archived sessions, with runtime capability checks for remote compatibility.
- 9dd59c0: Show model response errors in the chat transcript instead of leaving the conversation blank.
- 4bc390a: Keep machine/session navigation snappy by deferring expensive Pi-Web status refreshes and caching status checks.
- 577594a: Allow sidebar action/detail menus to expand beyond their list section when only a few rows are shown.
- f501f9d: Pin navigation activity indicators to the top-right of list chips so active projects, workspaces, and sessions no longer shift their labels.

## 1.202606.1

### Patch Changes

- 93b50e6: Replace add-machine browser prompts with a PI WEB form that asks for the remote URL first, suggests a machine name, and supports an optional bearer token.
- 08f69d0: Document built-in PI WEB plugins, including configuration guidance for Workspace Tasks.
- 9c3dafc: Delete workspaces through a server-side operation that closes target workspace terminals before running the worktree removal command, preventing stale machine activity indicators.
- 159f533: Fix workspace selection in the web UI so local machine project and session loading no longer fails with `api is not defined`.
- 82ba2e0: Prevent malformed session prompt API calls from crashing the session daemon.
- f2d211d: Harden remote machine plugin asset proxying so plugin asset URLs cannot escape the remote plugin directory.
- ccd4a76: Hide the Machines navigation section when only one machine is configured, align Machines list spacing with the other navigation sections, and add a remove action to remote machine rows.
- 193c9d0: Show machine activity indicators when sessions or terminals are active on any workspace for that machine.
- b5f8810: Add machine-scoped local project, workspace, file, and git API aliases as the next step toward machine federation.
- 4495a26: Make the mobile Actions entry available from the top context controls and remove the redundant PI WEB navigation header on mobile.
- 4548e5c: Use compact icons, initials, and inline badges for the mobile main tab bar so tabs are easier to fit without losing horizontal scrolling; let workspace panel plugins provide custom SVG tab icons; and add icons for bundled Info, Updates, and Tasks plugin panels.
- e352dce: Fall back to the local machine when a bookmarked or restored remote machine is offline, and clear stale remote workspace route state.
- bd8d1f1: Keep workspace tool tab icons visible in the desktop workspace panel and collapse tab names only in compact panel widths.
- 30fb960: Preserve machine, workspace, session, and terminal navigation memory across reloads within each browser tab.
- 08f69d0: Add plugin enablement settings so discovered PI WEB plugins can be disabled before the browser imports them.
- e3533eb: Add documented plugin context helpers for machine-scoped workspace files and terminal commands, generate plugin API declarations from source, and move bundled plugins away from direct PI WEB API calls.
- 8cd2bba: Keep the PWA refresh control menu visible above mobile tab navigation and workspace tab content.
- b3bb732: Remember each machine's last selected project, workspace, session, and workspace tool when switching machines in the web UI.
- a142f5e: Add remote machine federation so PI WEB can register trusted remote runtimes and proxy their projects, workspaces, sessions, files, git state, activity, and terminals through the current web server.
- b9be7de: Load trusted PI WEB plugins from selected federated machines with machine-scoped actions, workspace panels, labels, proxied plugin assets, and gateway-preferred duplicate handling.
- f1c8f1f: Clean up the workspace panel plugin context by moving render invalidation to `context.host.requestRender()` and deprecating the legacy runtime-only `openTerminal` alias in favor of `context.terminal.open()`.
- 4495a26: Add a deep-linked Settings UI for editing the active PI WEB config file and viewing registered keyboard shortcuts.
- a58c211: Add shortcut preferences to the PI WEB config schema so keyboard shortcuts can be overridden or disabled by action id.
- 0405b38: Add the first machine registry API and show the synthesized Local machine in the web UI as the foundation for machine federation.
- 4bc0010: Add workspace file and render helpers to plugin workspace label callbacks so labels can load workspace-scoped metadata without hidden panels.
- 08f69d0: Prevent redundant Workspace Tasks panel re-renders from resetting mobile scroll position or replacing task buttons mid-click, and show feedback for stale, cancelled, or already-starting tasks.
- 08f69d0: Bundle Workspace Tasks with PI WEB as a built-in plugin for running `.pi-web/tasks.json` commands in workspace terminals.

## 1.202606.0

### Patch Changes

- 6c094af: Keep slash command autocomplete visible above the chat status indicator.
- bad3a18: Add an action-palette command for deleting browser-cached new sessions, while keeping archive and delete session actions context-specific.
- fdd2cf2: Keep chat file mention suggestions working on installations that do not have ripgrep available, add an all-file `@` mention mode, stop hiding directories in the file explorer, and report optional ripgrep availability in `pi-web doctor`.
- a038da6: Fix mobile browser layout so the app no longer leaves an extra bottom gap above browser controls while preserving standalone PWA safe-area spacing.
- 9c80eb0: Avoid suggesting unavailable `pi-web` restart commands for local checkout installs, and show native service commands only when PI WEB can detect matching service files.
- 5090661: Add `pi-web version` and include installed and running PI WEB version details in doctor output.
- 9c80eb0: Rename the PI WEB status workspace tab to Updates so version and restart guidance is easier to find.

## 1.202605.14

### Patch Changes

- 3bd4773: Correct the chat history range label when normalized display messages are fewer than the raw session transcript entries.
- 1c1740a: Keep left navigation section titles visible while project, workspace, and session lists scroll.
- 5737b22: Add a collapse control for the left navigation panel in wide and two-panel layouts.
- 50f1ddc: Refresh session list message counts from live session status updates.
- c73ac5b: Keep PWA navigation bars visible after returning to the app from the background.
- 2abd1d9: Queue prompts submitted during session compaction in pi-web and deliver them only after compaction finishes.
- 958596a: Make `pi-web status` print a concise service health report without invoking paged system service output.
- f569467: Add an optional terminal soft-key bar for common control, navigation, and Meta-style key sequences, with mobile-friendly defaults and a persistent toggle.
- 61a763a: Keep the chat status indicator bubble above sticky message titles.
- 559c6f6: Add a desktop edge control for collapsing and expanding the workspace tools panel.

## 1.202605.13

### Patch Changes

- 57a6a4a: Improve `pi-web doctor` to report missing commands safely, skip Linux systemd checks on non-Linux platforms, and avoid misleading restart advice after the macOS node-pty permission workaround.
- 34e657d: Add a `pi-web doctor` diagnostic for the upstream macOS node-pty `spawn-helper` permission issue, including the workaround and tracking links.
- 8247281: Add macOS LaunchAgent service installs and a shared development install mode with `pi-web install --dev`.
- 4bfd4ac: Add homepage and remote-first website copy that explains PI WEB's persistent-by-default agent workflow.
- 679008d: Fix workspace and project activity indicators so stale session activity clears instead of reappearing after idle sessions.
- 56fa641: Restore spellcheck and autocorrect for prose in the web chat prompt while keeping command-like input protected from autocorrection.
- 711c4f3: Run workspace deletion and configurable workspace actions in visible PI WEB terminals with reload-safe command-run tracking, mobile-friendly cancellation, and shell continuation after command completion.

## 1.202605.12

### Patch Changes

- 13bb8e4: Add a theme-aware dash favicon and uppercase PI WEB page titles.
- 428f7bb: Add a session list action to archive a session together with its descendant sessions in the same workspace.
- f4aeb06: Make the mobile location breadcrumbs clickable so they open project, workspace, or session selection directly.
- 5bc2542: Extend chat diff row backgrounds across the full horizontal scroll area.
- 9e3d272: Prefill the prompt editor with the selected user message after forking a session.
- 23e82e1: Improve empty states for workspace tools and session selection when no project, workspace, or session is selected.
- a1e903f: Add cached image previews up to 10 MB to the workspace file browser for common image file types.
- df20563: Add refresh controls when PI WEB is launched as a PWA, with action palette commands for refreshing app data or reloading the page.
- 2f5293a: Fix mobile workspace panels, including the PI WEB status panel, so overflowing content remains scrollable on iPhone.
- 3409b0a: Name newly forked and cloned web sessions with readable Fork and Copy counters based on the source session title.
- 6a8f2f2: Prevent the message composer from inserting a stray blank line when starting a new session with the keyboard shortcut.
- 1546143: Add PWA manifest icons so installed PI WEB apps use the project icon.
- 1546143: Standardize user-facing PI WEB branding in uppercase across the app, docs, and install metadata.

## 1.202605.11

### Patch Changes

- 1f06b25: Make the Pi Web light/dark themes the default automatic theme pair and keep Classic as the fallback for missing theme selections.
- 619840a: Clear stale workspace activity indicators when sessions become idle or all remaining sessions are archived.
- 9d4a017: Deep-link terminal selection so action-created terminals open directly and reload back to the same terminal.
- 698a899: Load and watch first-party workspace plugin packages from the single Pi Web development command without requiring local symlinks.
- fb7903f: Document and harden separate Pi Web plugin package development, including the Actions plugin refresh flow and public terminal navigation helper.
- 32182a5: Allow Pi package installs to create systemd services from bundled Pi Web entrypoints when `pi-web-server` and `pi-web-sessiond` are not on the service shell PATH.
- 8fbdd6e: Prevent resize observers from attaching to missing UI elements during panel rerenders.
- 1f06b25: Keep loading other external plugins when one plugin fails during registration.
- 2631a63: Add persistent project, workspace, and session context in the web UI so mobile users keep their location visible while navigating between panels and chat.
- 3da2fcf: Add in-place overflow lenses for workspace rows so truncated workspace labels and plugin links can be read or clicked, and cap long project and session names to two lines.
- 894c4d0: Avoid automatically reselecting archived-only sessions unless an archived session was explicitly selected, and let closing the archived section clear archived session selection.
- cf1b0ed: Replace the workspace hover lens with a workspace actions/details menu so metadata remains accessible without blocking list scrolling or shifting rows.
- ea5d863: Preserve chat scroll positions more reliably across session and workspace changes, and keep live event groups collapsed when users close them during streaming.
- 0a086c9: Keep action-palette plugin actions responsive when they change workspace tools or routes.
- 3cce6d2: Rework chat scroll restoration around explicit bottom and anchor positions so session navigation and streaming updates keep the user's reading position stable.
- e5bc87b: Add a Go to Terminal action with a keyboard shortcut and clarify that plugin shortcuts are default keybindings attached to actions.

## 1.202605.10

### Patch Changes

- fb9e524: Build bundled Pi Web plugins from TypeScript during development and release packaging while shipping browser-loadable JavaScript modules.
- b637add: Update static file serving and WebSocket dependencies to patched releases, removing controlled dependency warnings and npm audit findings.
- ebe5639: Show active session and terminal activity on project and workspace rows so background work is visible from navigation.

## 1.202605.9

### Patch Changes

- 9c028a7: Move archived session files out of active Pi session directories so normal session lists no longer scan archived histories.
- 1d8dba9: Fix the homepage Keep control card icon so it renders clearly across browsers.
- c5dc655: Replace the chat history banner with a count-based conversation position meter that shows approximate message position without extra requests.
- 6f7713f: Contain long edit diff lines inside the diff viewer so they scroll horizontally within the tool card instead of widening the chat transcript.
- ee6f60f: Improve Pi Web tool cards for edit operations with live preview updates, paired call/result display, and rendered diffs that match the TUI more closely.
- 545499a: Add friendlier rotating in-progress response notices when opening a chat mid-reply.
- 71ce2fb: Make workspace navigation bars horizontally scrollable on desktop and mobile, with side shadows showing when more items are available.
- 547b6e6: Expand the live trailing events group while a session is active, then collapse it again once readable conversation output appears.
- e89441f: Make the mobile navigation panel sections collapsible so projects, workspaces, and sessions can each use more screen space.
- babb802: Add a beta-labeled Pi Web status panel with update instructions tailored to global npm, Pi package, or local installs. The panel appears for update/restart messages and stays visible for local or unknown installs, while keeping the bundled Info plugin as the minimal documented plugin example.
- 6f7713f: Keep chat bubble and event group headers sticky while scrolling so long messages remain easier to orient within the transcript.
- b51d56c: Add theme tokens, a theme picker, and built-in current/docs-inspired themes for the Pi Web UI.

## 1.202605.8

### Patch Changes

- c77c47c: Document the Pi Web CalVer release rule so releases use the release month, increment the patch component for additional releases in the same month, and require explicit user confirmation before any breaking major release.
- 3099579: Document and tighten the Pi Web plugin API around explicit `piWeb.plugins` metadata, versioned browser modules, AI-oriented local plugin development, website plugin docs on pi-web.dev, feedback guidance, and resilient discovery that skips invalid plugins without hiding valid ones.

## 1.202605.7

### Patch Changes

- aab9ffb: Preserve newly started empty sessions and their prompt drafts across browser reloads until the user deletes them.
- c5bc855: Improve `pi-web doctor` and `pi-web install` to use the detected bash, zsh, or fish login shell, verify the systemd user service context can find required commands before installation, and print shell-specific PATH setup advice without persisting transient PATH values.
- 9b1b1bb: Fix the docs mobile navigation so FAQ pages no longer overflow and compact the GitHub/theme controls on small screens.
- 0aa0a13: Fix chat history reloads so previously displayed messages are not duplicated from the browser cache.
- 42cad58: Add remote-first development positioning to the website and docs, including a philosophy page and laptop-versus-server FAQ guidance.
- c66d834: Add a static Pi Web website with installation docs, troubleshooting FAQ, and GitHub Pages deployment.
- 6a8f8b6: Add global web UI `/login` and `/logout` flows for configuring API key and subscription provider authentication.

## 1.202605.6

### Patch Changes

- 559436c: Install Pi Web services from the Pi extension using the normal login-shell command shims instead of hardcoded Node paths, so sessions use the same PATH for node and npm.
- c547478: Keep mobile workspace selection in the Sessions view so users can confirm the remembered session before opening chat, and restore mobile URLs without an explicit view back to Sessions.
- 42b9c53: Remove unsupported direct GitHub install instructions from the README.

## 1.202605.5

### Patch Changes

- a807569: Fix browser terminal sizing so progress/status lines update in place instead of wrapping when the PTY size has not caught up with the visible terminal.
- d064c4e: Improve package gallery discoverability for remote web UI and browser control plane searches.

## 1.202605.4

### Patch Changes

- 7a9e7db: Copying selected rendered chat markdown now places the raw markdown source on the clipboard.
- cf43c95: Formalize release notes with Changesets and project-local skills for changelog and npm publishing workflows.
- e12382c: Keep a new prompt separate from the stopped prompt after aborting a session turn.
