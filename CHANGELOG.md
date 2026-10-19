# @chainingintention/pi-web-cn

## 1.202610.2

### Patch Changes

- a8598f7: Order archived sessions by their latest activity instead of archive time.
- a8598f7: Show all matching slash commands and skills in the composer instead of the first twelve.
- a8598f7: Load the web app manifest through authenticating reverse proxies.
- a8598f7: Let agents follow explicit user authorization for a session daemon restart while warning that it interrupts active sessions.
- d0d3d7b: 随包提供中文化的可选船长日志示例及独立浏览器产物，默认不安装、不启用。补齐服务端插件 API 的运行时导出及 peer 通道关闭错误类型，供公开接口消费者使用。

  将 Mermaid 渲染入口与隔离图表引擎构建到同一独立浏览器目录，避免发布未经打包的浏览器源码依赖图。

- d7fcb23: Constrain images rendered inside chat markdown to the width of their message so large screenshots no longer overflow the conversation.
- 91cfd35: 开发 Docker 实例使用独立的会话守护进程 socket，避免与生产实例冲突；保留插件操作旧标识下保存的快捷键设置。会话列表缓存树结构并按会话身份保留行元素，同时保留固定和增量加载行为。
- a8598f7: Dismiss pending questions when a queued user message reaches the model.
- 9fc4790: Move the Files and Terminal workspace panels into bundled plugins while keeping existing file operations and Chinese UI. Interactive terminals stay unavailable in management embed, as before. Management embed command runs stay sandboxed in the core terminal service.
- 2091088: 修复聊天消息分组时丢失历史节点身份，恢复消息旁的分叉与回退操作。修复窄屏刷新聊天链接后错误打开会话列表的问题。
- 2091088: 修复自定义发送组合键被全局快捷键抢占的问题，支持编辑器按配置发送并保留命令补全、换行及输入法行为。
- 91f72bd: 修复分离父会话时延迟响应覆盖其他机器会话或最新会话信息的问题，并禁止通过分离接口修改只读归档会话。
- 2091088: 修复 Git 面板首次加载状态时清除直达差异文件选择的问题，保留刷新和重新连接后的差异 URL。
- 0dd7e2a: 修复完整特权管理会话仍被网关的工作台资源续期阻断的问题，保留初始 Agent Session 绑定和受限模式的资源校验。

  管理嵌入页面显示插件加载失败的具体原因，并在重试成功后清除错误。

- 0dd7e2a: 修复切换机器后旧模型或思考级别请求覆盖当前会话状态的问题。切换会话或模型时关闭已失效的模型、思考级别选择弹窗，避免旧选项作用于新会话。
- fa56a98: 项目或工作区移除、会话完成后，在后台清理失去归属的未读完成状态，避免指示器一直亮起。清理以一分钟延迟合并执行，跳过空目录，普通读取不触发工作区扫描；重新添加项目前先清除旧的孤立未读状态。保留会话和项目文件，项目增删操作需要会话守护进程。
- 2091088: 修复非法插件清单的诊断导致插件服务端状态被误判为不兼容、Git 面板无法加载的问题。继续严格拒绝不合规插件，不影响其他合法插件运行。
- 0dd7e2a: 修复会话重新加载后仍沿用旧模型范围的问题，并同步同项目的模型选择器。重载期间切换机器不再误清除新机器的同名会话缓存或触发错误的历史请求。修复工作台管理嵌入被未使用的终端插件故障阻止加载其他插件的问题，保留普通模式的终端必需校验。
- bf22f02: 修复符号链接重命名误移动目标文件、会话清理遗漏项目自定义 sessionDir、管理文件工具误解析 /workspace 下真实绝对路径，以及取消终端命令后仍显示成功的问题。

  修复 daemon 所有权并发抢占、展开目录失效阻断文件面板刷新、默认模型保存与会话信任状态不一致，以及普通/管理会话并发启动时的权限环境污染。管理嵌入会话直接通过项目信任，不改变普通模式的信任决定。

  升级所有权保护时需先停止旧 daemon，再启动新版本。所有权更新中途崩溃可能留下 sessiond-owner.json.lock 空目录；确认没有 daemon 正在启动或停止后才能清理并重试。

- 5cd88b5: 应用回到前台或重新连接时刷新工作区会话列表，无需刷新页面即可看到断连期间创建的会话。
- a8e1b10: 修复同一用户、同一工作区的受限管理会话互相覆盖权限策略的问题。按生效策略隔离存储并原子写入，避免并发启动时加载其他会话的工具限制。

  修复 `/reload` 丢失管理权限环境的问题，并隔离普通会话重载与管理会话启动，避免扩展重新加载时读取其他模式的权限策略。

- c9d6119: 修复 systemd 审计和管理嵌入 drop-in 导致的服务环境误报，并让启动、重启与 doctor 的 Web 就绪检查读取已安装服务的配置。保留显式配置覆盖、数据目录和守护进程传输一致性检查，以及 EnvironmentFile 的严格拒绝策略。
- b7e4b67: 允许管理嵌入会话默认使用工作区内的受限 bash 工具，保持默认断网、不暴露其他宿主目录，并继续遵循明确的工具允许与拒绝规则。沙盒不可用时拒绝执行，不回退到宿主 shell。

  机器明确允许特权，且签名令牌同时授予 bash 与网络权限时，管理代理改用普通模式的工具及资源加载规则，忽略管理令牌的工具允许与拒绝列表；保留项目信任、管理身份、独立认证与偏好、审计和子会话管理上下文。单项授权不会开启完整权限。

  完整特权模式不再注入管理专属工作台工具与只读能力指令，不要求工作台资源续期，也不强制同步管理 Skills 或覆盖项目 Relay 模板。

  整合已发布的管理权限修复：平台注入的只读 AGENTS 指令不进入完整特权提示，原文件和用户指令保留；普通权限策略环境与项目信任继续生效。

- c9d6119: 补齐命令补全来源的中文标签，以及新会话默认值、发送键和参数提示文档。图表预览改用与上游一致的完整 Mermaid 引擎，在无网络的沙箱中渲染并清理 SVG；保留加载失败时回退源码的行为。
- a8598f7: Keep dialog actions within the available viewport on mobile devices.
- d7fcb23: Keep the chat composer reachable on mobile when the on-screen keyboard opens by letting the viewport resize with the keyboard.
- 7a02e56: Show only navigation destinations available in the current layout and preserve navigation preferences across viewport changes.
- 9d198d3: Clear ordinary-mode unread indicators when their owning projects or workspaces are removed, while preserving management-mode isolation.
- eac1450: Support Pi 0.87 alongside the tested Pi 0.86.1 runtime and display visible boundary-draft transcript entries without applying context edits to chat history.
- 1e8f5c8: 为浏览器插件动作和工作区面板增加 `context.navigate(destination)`，使用宿主导航及目的地不可用提示。Captain's Log 翻译条目增加打开来源会话的操作。
- d45c7f9: Upgrade bundled plugins to browser plugin API v4 and server plugin API v3 with no compatibility shim. Package-paired server requests now go through `peer.request` instead of the legacy workspace-provider `request` method. This note records a breaking plugin API change; it is not a major release.
- 8fcb725: 对齐浏览器插件的公开选中会话状态与必需的运行时身份，避免向外部插件传递内部会话字段。独立 Pi 包按各自的 src/dist 布局重新构建，排除陈旧产物、测试文件和非发布元数据，同时保留插件构建就绪门槛与符号链接防护。
- a8e1b10: 修复目录移动和删除接口误操作符号链接目标的问题：目录接口拒绝末级符号链接，保留链接及其真实目标，同时继续支持工作区内的链接父目录。
- a923302: 队列中的聊天消息送达会话时，关闭尚未回答的问题，包括消息入队后才出现的问题。
- 0e4d29c: 项目和机器对话框适应手机短屏的遮罩可用空间，并允许项目内容滚动，确保操作按钮可达。模型、认证和命令选择器同样适应可用遮罩高度。
- a8598f7: Refresh workspace sessions after browser resume and realtime reconnect so sessions created during a connection gap appear in the list.
- c9d6119: 修复内置 Relay Pi 包的浏览器插件清单，避免中继面板因不受支持的元数据被插件目录拒绝。
- 076f4b3: 恢复管理模式 Elasticsearch 审计的内容记录：受限和完整特权会话均保留用户问题、模型可见回复（不含思考内容）、工具参数和结果。服务日志及普通模式 SQLite 仍只保存元数据；审计正文可能含敏感数据，请限制 Elasticsearch 访问，升级后手动重启会话守护进程。
- c9d6119: 为新会话记住模型和思考等级默认值，并在聊天里提供已保存消息的分叉和回退。斜杠命令补全会显示参数提示；发送键可按桌面和手机分别设置，未保存前仍沿用当前浏览器的 Enter 偏好。这些编辑器功能在普通模式和管理嵌入中都可用，交互终端仍仅限普通模式。
- 81e937d: Add shared chat content renderers, chart preview, and workspace file links in both ordinary mode and management embed. Interactive terminals stay unavailable in management embed. File management stays in the existing Chinese files panel.
- d7fcb23: Disable Vite's development reload connection while preserving its dynamic-import helpers, so reconnecting a suspended PWA does not reload the UI or stall PI WEB realtime sockets.
- 995902d: 将文件面板迁移为独立浏览器插件，保留新建文件和文件夹、移动或重命名、删除及下载，并提供独立预览、上传进度与取消。目录操作通过可选公开能力接入，保持旧宿主兼容及机器、工作区隔离。
- 723c279: Add searchable, pinnable navigation tabs and keep unavailable URL destinations visible as errors.
- d0d3d7b: 按照上游严格校验浏览器插件清单：必须显式声明 browserRoot，用户插件不得占用保留命名空间。不符合要求的旧插件会跳过并报告错误，不自动改写插件或数据。内置清单已同步适配；浏览器资源仅从声明目录的内容版本快照提供，支持默认不启用的可选插件。
- 84cf28d: 对齐上游会话守护进程的 HTTP 空闲超时设置、工作区插件取消与退出清理；启动失败时回收已创建的资源，退出时继续清理失败的组件，并在关闭服务后释放状态所有权。
- 9874a04: 补齐远端文件操作的超时、响应大小和断连取消边界，并按上游限制会话列表首条消息预览长度；完整会话与归档内容保持不变。
- d530ab1: 补齐上游工作区稳定渲染、跨实例会话活动提示和弃用配置诊断，限制插件通知保留数量，并随包提供中文工作区插件示例和安装后的公开 API 消费者验证；保留项目认证、管理隔离及现有导航兼容。
- 05e91ad: 将普通终端切换为内置 Terminal 插件独立拥有的浏览器、PTY 和通信运行时，保留中文界面、旧导航链接、机器隔离与 Windows shell 支持。管理嵌入仍使用独立受控命令执行与沙箱，不能调用普通终端插件。

  按上游严格检查插件生命周期和必需 Terminal 契约；缺失、禁用或失败时不再退回宿主终端。更新时需同步重启 Web 与会话守护进程并刷新浏览器；显式无服务端插件恢复模式可用于修复配置。插件运行失败通知保留项目、工作区范围。

- d530ab1: 增加按机器归属的弃用代理配置诊断与中文提示，保留现有配置兼容且不自动迁移用户配置。限制插件通知的按来源和全局保留数量，避免插件通知淹没核心通知；管理嵌入继续隔离普通模式通知。
- 84cf28d: 对齐上游浏览器插件的依赖排序、机器作用域、生命周期超时与失败回滚，并补齐公开插件运行时契约。项目资源按 Pi 的项目信任设置加载，可在添加项目或工作区菜单中显式调整信任，不自动批准已有项目。

  保存全局配置时移除已废弃的 `respectProjectTrust` 字段，保留其他配置和现有信任决定；旧字段不会绕过项目信任检查。

  防止过期认证请求恢复已关闭的对话，默认模型和思考星标保存期间阻止重复提交，并保留输入法 Escape、原生插件弹窗及非编辑区快捷键序列的交互边界。

  对齐插件宿主导航、旧链接和快捷键操作别名，按所选机器的生命周期能力显示插件诊断与离线恢复；保留浏览器 Enter 偏好，并支持独立配置桌面与触屏发送键。船长日志作为可选包显示，未经用户安装不自动启用。

  保留独立 Files/Git 插件中的分批列表与选中项可见性，修复目录行挤掉普通文件、后台刷新重复请求和历史导航隐藏选中项的问题，继续使用中文安全预览提示。

  管理嵌入仅加载可用且版本有效的服务端配对插件；普通终端由独立插件拥有，管理命令仍使用独立沙箱与权限检查。服务启动和诊断按已安装配置选择就绪探测目标，保留显式配置覆盖与审计命令。

  Anthropic 订阅认证提示使用会话所属认证源，不读取其他项目或模式的凭据；浏览器在认证期间断开时不遗留后台会话连接。

  保持更新、Web/UI 重启和守护进程版本异常提示为中文，不改变版本、命令或底层诊断内容。

  会话重命名完成后仅更新原机器、项目工作区和会话文件仍匹配的列表；切换目标或关闭页面时，迟到结果不会修改同名 ID 的其他会话，重命名其他列表项仍保持当前对话不变。

  聊天消息分叉与回退的等待状态和错误提示按机器、会话和工作区隔离，切换目标或断开页面后，旧请求不会覆盖新目标的提示或清除新请求的等待状态。

  恢复浏览器唤醒时对独立工作区面板的资源刷新，并避免键盘设置重复列出桌面和移动发送快捷键。

- c9d6119: 协调开发环境的插件构建与服务启动：Web 完成首次构建后才启动 API，daemon 等待插件就绪；开发服务启动和服务重启先验证 Web，再处理 daemon。Web 构建或就绪检查失败时不重启 daemon，保留其手动重启和活动会话所有权。
- 91cfd35: 补齐插件文件能力的上传路径、进度、取消与版本引用接口，保留旧参数兼容，并将读取取消信号传递至工作区请求。
- 2feb6f3: 修复工作区删除轮询的取消、失败重试和切换作用域清理，并防止旧的异步导航覆盖新选择；保留管理模式隔离、旧链接和会话创建交接。
- 3db310c: 补齐插件面板导航、贡献级 URL 查询状态和资源失效通知，兼容旧贡献链接并隔离不同机器的导航记忆。切换工作区、面板或历史记录后，旧上下文不能覆盖当前导航。
- d530ab1: 减少聊天流式更新对工作区面板和导航列表的重复渲染，保持插件显式刷新与路由变化及时生效，并合并短时间内重复的工作区拓扑刷新。

## 1.202610.1

### Patch Changes

- Remove remaining management tool deny lists and platform-injected read-only AGENTS instructions from fully privileged agent sessions so they follow normal-mode tool and local resource rules. Preserve sandbox restrictions for other management sessions and retain shared files and user-authored instructions.

## 1.202610.0

### Patch Changes

- Let fully privileged management agent sessions use normal-mode tools and local resources when the machine opts in and the signed token grants both bash and network. Preserve explicit tool denies, management identity, separate credentials, and audit attribution; single grants remain sandboxed.

## 1.202609.12

### Patch Changes

- Allow management-embed sessions to use workspace-isolated bash by default while preserving explicit tool restrictions and separate authorization for host visibility and network access.

## 1.202609.11

### Patch Changes

- 2523db8: Fix workspace removal failing when a completed request body is mistaken for a disconnected browser.
- 7c8ee9f: 将 Pi SDK 升级至 0.86.1，适配 transcript 系统消息上下文，获得 Meta Muse 登录、提示缓存预热、离线 Radius 模型目录与上游提供商修复。
- 12211e0: 去掉网关访问本地会话守护进程的 30 秒默认超时，避免对话进行中把忙碌的守护进程误报为不可用。浏览器断开或工作区删除等调用方取消仍会中止对应的下游请求；后台刷新被取消时不再弹出错误横幅。

## 1.202609.10

### Patch Changes

- 8dc5ce0: 优化普通模式 Bearer 鉴权：复用短期成功验证结果，使用有界异步密码校验，避免重复请求阻塞 Web。密码配置变更会使旧认证结果和浏览器会话失效；保留密码哈希强度和现有限速。
- 10a3919: Improve sessiond connection reuse and disconnect slow realtime clients before their outbound buffers grow without bound. Add a dependency-free local load runner for measuring HTTP, WebSocket, event-loop, CPU, and memory behavior under concurrent clients.

## 1.202609.9

### Patch Changes

- 477e709: Allow signed management-embed tokens to grant a constrained bash tool with read-only host filesystem access, HTTP/web-fetch/web-search, and sandbox network when `managementEmbed.allowPrivileged` is enabled.

## 1.202609.8

### Patch Changes

- ddf87cb: 修复连续文件操作时目录列表可能回退，以及切换机器或工作区后文件和 Git 面板被旧刷新请求阻塞的问题。修复无关项目的工作区查询失败导致正常模式会话操作失败的问题，并保留清理范围无法完整确认时的保护。
- c2f38ff: 隔离普通模式与管理嵌入模式的会话清理和归档范围，并减少大项目中的重复文件、目录和 Git 状态扫描与渲染。

## 1.202609.7

### Patch Changes

- a643228: 支持在工作台管理嵌入会话中发现已授权的 BookStack 书籍，并通过独立只读工具检索记忆笔记正文及来源引用，沿用工作台一次性授权凭证和元数据审计。

## 1.202609.6

### Patch Changes

- 1d3eafd: 修复管理端嵌入会话在入口 Token 或资源授权过期后需要返回工作台重新进入的问题。在原始管理登录有效期内自动续期私有 Agent Session，并在页面请求和工具调用前重新校验当前权限。

  需要配套工作台后端提供 Agent Session 续期接口；已撤销授权、禁用账号和超过登录有效期的会话仍会被拒绝。

## 1.202609.5

### Patch Changes

- 自动对话标题根据用户输入的语言生成，保留原有简短标题要求。
- 将 Pi SDK 升级至 0.85.1，获得上游模型与提示缓存修复，并移除 0.85.0 导入故障所需的临时 pi-server 依赖。

## 1.202609.4

### Patch Changes

- Pin Pi SDK peer dependencies to the verified 0.85.0 release so fresh installations use the same SDK as the release tests.

## 1.202609.3

### Patch Changes

- Restrict management credentials to scoped APIs and validate session workspace access consistently. Prevent workspace uploads from following dangling links outside the workspace.

  Preserve streamed messages when detaching a parent session, serialize concurrent Workbench Skill synchronization, avoid Windows file-lock conflicts during concurrent Relay template updates, and recognize provider-owned workspaces for project credentials and spawned sessions.

  Ignore stale file-tree, Git diff, and history-page responses after navigation. Keep remote JSON request deadlines active until the response body is consumed.

- Provision and refresh both Relay skills for management sessions, including relay-runner. Keep both available with Workbench authorization while leaving normal-mode project skills untouched and preserving unrelated collision warnings.
- Isolate unread completion state and notification inboxes between normal mode and each management context, including catalog reads, acknowledgements, dismissals, runtime replacement, cleanup, and realtime events. Preserve unread state after a managed runtime closes without exposing it to other users.
- 修复 /model 和 /scoped-models 无法打开模型选择界面，以及 /fork 的迟到响应干扰其他会话的问题。
- 修复执行 /tree 后会话树弹窗无法显示的问题。
- 升级静态资源服务及相关间接依赖，保持 Pi SDK 版本不变。

## 1.202609.2

### Patch Changes

- d1a939c: Force-sync management-mode project Relay skills to the current bundled template and avoid duplicate warnings for identical project and bundled copies, without modifying project skills in normal mode.

  Support Pi SDK 0.85.0 with its required server dependency, constrain SDK compatibility to the tested minor series, and verify web and session daemon startup after package installation.

## 1.202609.1

### Patch Changes

- 35ced85: Add prompt attachments, atomic model visibility controls, resilient transcript refresh, server notices, and scoped browser error reporting to session workflows.
- 35ced85: Ship Relays as an automatically installed Pi package and distinguish development deployments with dedicated browser and PWA identity assets.
- 35ced85: Prevent management-embed access to normal-mode server notices. Preserve selected session-tree branches and unsent attachments during refresh and session startup, and stop transcript polling when its browser connection ends.
- 35ced85: Make service diagnostics tolerate harmless package-owned systemd drop-ins, improve update command guidance, and keep the OpenSUSE container PATH aligned with other images.

## 1.202609.0

### Patch Changes

- 2d95363: Allow management embed launch tokens to update platform-managed AGENTS.md instructions, preserve unmarked project files, and append a backup before each managed overwrite.

## 1.202608.16

### Patch Changes

- Add Workbench-controlled RAGFlow knowledge retrieval tools for management-embed sessions without exposing RAGFlow credentials or dataset identifiers to PI WEB.

## 1.202608.15

### Patch Changes

- 95305e3: Initialize missing management-embed project instructions from the trusted launch token without overwriting existing `AGENTS.md` files.
- f039fdd: Update the bundled Pi runtime packages to 0.84.3.

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

## 1.202609.1

### Patch Changes

- 5428a33: Order archived sessions by newest activity, consistent with active sessions, and process bulk archives oldest first using existing metadata without reading archived transcripts.
- 158c834: Bound session-list first-message previews to prevent oversized sidebar payloads while preserving complete session data.
- 0817e8b: Make Files an enabled-by-default bundled browser plugin that can be disabled independently. Preserve workspace browsing, previews, downloads, and cancellable uploads; disabling the panel leaves workspace-file access available to attachments and other plugins.
- 2e8fd91: Add confirmed Clone and Go back shortcuts beside Copy on persisted chat messages.
- 00f5b80: Open relative chat Markdown file links (including `./` paths and redundant separators) and absolute paths inside the session workspace in the Files panel through an optional plugin file-opening hook. Keep downloads as the fallback when no enabled panel handles the file, and for modifier/new-tab clicks. Preserve web, email, anchor, and other root-relative links.
- a18b194: Show all matching slash commands and skills in scrollable autocomplete instead of limiting results to twelve. Display prompt-template argument hints beside commands and as editor ghost text after selection, including hints for `/name` and `/compact`.
- cd467f4: Allow agents to stop or restart their hosting session daemon when explicitly authorized by the user, with interruption warnings and detached scheduling guidance.
- c73b9d4: Deliver Terminal as a required bundled browser/server plugin while preserving shell panels, replay, reconnect, command execution, and selected-machine workflows. Pair browser and server revisions, scope requests and streaming channels to the workspace, and provide safe-start recovery when Terminal cannot activate.
- 3625a62: Fix web app manifest loading behind authenticating reverse proxies by including credentials in manifest requests.
- 4553f81: Keep Terminal shell selection and URLs correct when switching projects or workspaces, starting or closing shells, and reconnecting during overlapping loads. Prevent superseded Terminal navigation from starting an unwanted shell or overwriting a newer selection.
- 77c4f52: Add independently configurable desktop and touch-or-narrow-screen send-message shortcuts in Settings → Keyboard. Support Gmail-style app shortcuts such as `g p`, without intercepting ordinary typing in editable fields.
- 702a4b8: Keep spawned sessions and Relay handoffs on the inherited model unless their instructions request a specific model or a model choice.
- 551b106: Let plugin backends create visible hosted conversations without an initial prompt and exchange native Pi package events with new or explicitly selected existing sessions. Conversations survive initial completion and plugin disposal; disconnecting a plugin does not stop agent work. Wait for extension startup before accepting work, and report provider failures and retry cancellation accurately.
- bb77eff: Allow unrelated environment variables when checking managed systemd services while still rejecting directly configured `PI_WEB_CONFIG` mismatches. Accept `EnvironmentFile=` with a nonfatal warning that file-based config overrides cannot be verified; readiness checks use the installed config path unless explicitly overridden for the command.

  When restarting managed services, wait for the web/UI service to become ready before restarting the session daemon. If web startup fails, leave the daemon untouched. Development startup follows the same ordering and allows extra time for plugin builds.

- aa1d06c: Constrain markdown-rendered images to the message card width: add `img { max-width: 100%; }` to the formatted-text markdown styles so wide embedded screenshots no longer overflow the transcript card and viewport.
- 9505966: Introduce browser plugin API v4 and server plugin API v3, with dependency-aware lifecycles, typed capabilities, exact-package peer requests and channels, persistent plugin storage directories, and live workspace access. Plugin authors also get a typed selected-session snapshot and early validation of required hosted-session capabilities. Shipped examples and Captain's Log require PI WEB `^1.202609.1`, excluding earlier releases without these APIs.

  **Breaking change for plugins:** Existing plugins must be adapted to this version of PI WEB. Previous plugin API versions are not compatible.

- b06952b: Replace the session-bridge greeting example with an opt-in Workspace Reviews Pi package. Review uncommitted workspace changes in a dedicated session, save correlated findings or failure status in plugin-owned storage, and browse saved reviews as plain text. The package is not installed by default.
- bc574ea: Make Relay development legs prioritize usable behaviour, connect necessary prerequisites, and reserve research-only work for concrete implementation blockers.
- 2d64b8a: Support Pi 0.87's transcript-based SDK, including automatic session titles. Require Pi 0.87.0 or newer.
- 2d64b8a: Display visible messages and compaction summaries appended by Pi extension boundaries in live chat without requiring a reconnect.
- c7b20b9: Add tab pinning across desktop and mobile navigation, with all tabs shown when none are pinned, plus an independent option to collapse mobile tabs into a searchable navigation menu. Preserve breadcrumbs, separate actions, and pin preferences across layouts; show only layout-relevant destinations and highlight the menu when it contains the active hidden tab. Open Navigation is available in Actions and can be assigned a keyboard shortcut.
- 28c778e: Add star controls to the model and thinking-level selectors to save defaults for new sessions without changing the current session.
- 7085035: Reject symlinked saved records on Windows in Captain's Log and the workspace review example, matching their behavior on Unix.
- Let server plugins report project-, workspace-, and session-scoped notices with clear plugin attribution. Validate and limit retained plugin notices without displacing core notices, stop accepting reports after plugin shutdown, and preserve Terminal workspace-removal failure messages.
- c139779: Preserve explicit project trust choices when navigation changes while adding a project, and report failures to save those choices.
- 851bb2f: Preserve requested URLs for unavailable machines, projects, workspaces, sessions, and tools instead of silently showing a different destination. Show failures in the requested content area and leave valid tabs available for recovery. Unknown views show a warning and a responsive display fallback without rewriting the URL; the warning clears on valid navigation. Panel selection (`view=navigation|chat|workspace`) is now separate from workspace tab selection (`tool`); old URLs that put a tab ID in `view` need updating.
- 628da41: Close pending questions when /tree moves to a different conversation position, without waking the agent or adding messages to the selected branch.
- e65b9ce: Reduce unnecessary interface updates during session activity and background terminal/Git refreshes. Preserve session row identity when lists change, and keep background Git refreshes from flashing loading controls.
- 5e96917: Give sessions being created a unique URL and safely replace it when ready, preserving tool/view changes without taking over navigation elsewhere. Recover expired creation links without starting another session.
- 1ba2d03: Add Captain's Log, an optional prebuilt Pi package that retells the selected conversation's last completed assistant reply as a pirate briefing without changing the original. Install it from Available packages and explicitly enable its plugin; no compilation is required. Its one-button panel creates or reuses a dedicated conversation, preserves previous results, and displays Markdown without executing embedded HTML or loading remote images.
- becd39e: Add plugin-provided previews to chat Markdown, Files Markdown previews, and standalone text files, including bundled Mermaid diagrams rendered locally in a network-blocked sandbox. Previews default to manual rendering unless a plugin opts into automatic rendering; raw source and copying remain available during streaming or failures.

  Choose a renderer and switch between Render and Raw per diagram or file. Files respects saved Raw/Preview preferences and URL overrides, with scrollable previews and a pinned header. Chat remembers explicit per-diagram choices in the current tab for 15 minutes; changed source or unavailable renderers clear those choices.

- 7ae2bd5: Show an advisory notice when a shared session was recently active in another PI WEB instance, helping users avoid working on the same conversation in both instances at once. Detection is best-effort and does not lock the session or prevent concurrent work.
- a7c8339: Keep the address bar and displayed machine, project, workspace, session, and tool aligned during overlapping navigation and loading. Preserve loaded lists when switching views, and prevent stale results, plugin failures, or session recovery from replacing a newer destination. Fix archive and history navigation from abbreviated session links, and preserve the selected session during cached-session recovery.

## 1.202609.0

### Patch Changes

- c34b0a3: Add an `attachments.defaultFolder` config key to customize where chat-composer prompt attachments are saved, mirroring `uploads.defaultFolder`: set it in the global config file or Settings → General for the selected machine, override it per project in `<project>/.pi-web/config.json`, and see the workspace-effective folder in the composer's "Save to …" delivery option. Without configuration, attachments are still saved to `.pi-web/attachments`, and an explicit per-request folder keeps winning over the configured default.
- 9ce008b: Make the running instance identifiable at a glance where no browser chrome helps. In an installed PWA window, the header shows a machine control: a dropdown listing every machine with its own favicon (dimmed when offline) when a choice exists, or a static bubble with the instance favicon and gateway address when only the local machine exists; the mobile breadcrumb leads with a Machine chip carrying the same identity. In a regular browser tab the location indicators stay hidden and the machine control remains a pure selector. Development deployments (Docker dev mode or a source checkout) recolor the favicon and PWA icons purple and install the PWA as "PI WEB (dev)".
- 61c4684: Add `interactive-widget=resizes-content` to the viewport meta so Chromium-based mobile browsers resize the layout viewport while the on-screen keyboard is open, keeping the prompt composer visible above the keyboard. Browsers that ignore the directive keep their current behaviour.
- 24e1e22: Support Pi SDK 0.85.x and exclude the broken `@earendil-works/pi-coding-agent` 0.85.0 release from the peer range: its published package could not be loaded at all, which prevented PI WEB from starting. Fresh installs now resolve Pi SDK 0.85.1 or later, while existing 0.84.x installs remain supported. A new package-integrity test also makes this class of upstream packaging defect surface as a single clear test failure during development.
- c9c06ea: Bound the idle-session transcript snapshot cache so a long-running session daemon no longer accumulates the parsed transcript of every session ever polled; snapshots are now evicted least-recently-used first past a small limit.

  Fix status and message reads for idle sessions whose transcript file does not exist on disk (never persisted yet, or removed externally): they now serve the live runtime branch instead of failing.

  Speed up polling of an idle session whose transcript file keeps growing: when another process appends to the file, only the appended bytes are read and parsed instead of the whole transcript being re-read every few seconds. Any change other than a pure append (replacement, truncation, in-place rewrite) still triggers a full re-read.

  Stop polling of a never-persisted session from rescanning its session directory on every tick: transcript file resolution is now throttled, so an idle in-memory session polls at constant cost while still noticing a transcript file that appears later.

  Stop a failing background poll of the selected session from churning the global error banner every few seconds: automatic poll failures are now only logged, while user-triggered refreshes still report errors.

  Skip redundant work when a poll of the selected session changes nothing: a tick whose messages, status, and in-flight partial all match what is already shown no longer re-merges history, rewrites the cached transcript, or re-renders.

- 2e7fa58: Keep no-summary session-tree navigation on the selected branch and restore active user or custom-message text for editing.
- d2e74d5: Preserve line breaks and indentation in supporting question and option details shown by `ask_user` forms and transcript records, with supporting text aligned beneath each question and placed closer to it.
- 7149fe4: Keep selected sessions current when another Pi process appends to their transcript, without replacing active Pi Web runtimes.
- cf7cb35: Split Relay into a tool-agnostic foundation and an opinionated `relay-runner` software-delivery profile, make `/relay` build reviewable drafts and require explicit approval only before dispatch without pre-planning the chain, keep charters centered on goals and scope edges while project guidance owns quality, retain `/relay-worktree` as a compatibility alias, make handoff the final operational action while allowing a dispatch summary, require review, approval, and delivery before Relay completion, and treat two whole-work review attempts as normal while reserving a third for a justified contingency before human intervention.
- 5cc9b2a: Keep authentication failures associated with the machine that owns the login or logout operation instead of replacing unrelated global feedback.
- 31e4120: Keep browser error feedback associated with its workspace or session, and avoid duplicating workspace-removal failures already recorded as server notices while preserving feedback when the session daemon is unavailable.
- 317418c: Keep machine and project browser failures associated with their owning context instead of replacing unrelated global feedback.
- dddb9d4: Show server-owned notices only in their relevant project, workspace, or session context.
- 238e8df: Show failed workspace removals as dismissible server-owned notices that survive browser and API restarts.
- 88da8a1: Tolerate package-owned global systemd drop-ins when inspecting managed services, so `pi-web install`, `start`, and `doctor` work on stock Fedora and Bluefin (whose `service.d/10-timeout-abort.conf` applies to every user service). Overrides that alter the managed environment still fail closed.
- 460a04b: Rework the Updates workspace tab so it presents a single prominent action: when an update or restart is available, the recommended command now sits at the top with the status notices folded in as context, installed services stay in the middle, and optional finer-control commands move to the bottom. Notices no longer carry their own command buttons, so the panel never shows two competing recommended actions.

## 1.202608.2

### Upgrade warnings

- **Breaking project-trust default — existing projects may need to be trusted again:** PI WEB now always enforces Pi's project-trust model and removes the `respectProjectTrust` opt-in environment variable and config key. After upgrading, a workspace without a saved trust decision becomes untrusted, so its project-local `.pi/` resources do not load until you trust the workspace from the workspace menu or while adding the project, or set `defaultProjectTrust` to `always`.
- **Restart the session daemon after upgrading** on every machine so the project-trust enforcement, enabled-model synchronization, Pi version reporting, and Relay package auto-installation take effect.

### Patch Changes

- 62f704a: Add a search box to the provider selection list in the authentication dialog, so long subscription/credential provider lists can be narrowed by name or id. The search also applies to the stored-credential removal step.
- 2d60542: Make `pi-web doctor` exit nonzero when an installed Web/UI or session daemon component is unavailable or stale (restart needed), instead of only reporting it in the version section. Machines with no PI WEB services installed keep the previous informational behavior.
- 0b6497b: Trim surrounding whitespace from the path when adding a project, so the stored project matches the path the trust preview showed and no whitespace-padded folder is created.
- e31d283: Fix the Add Project dialog showing "Loading folders…" forever without folder suggestions once a path was typed.
- 70cb7ee: Fix pending file/image attachments in the chat composer leaking into other sessions when switching sessions, or vanishing while a new session was still being provisioned.
- 7344b31: Fix the prompt editor caret height before any text is entered, and keep the caret and selection highlight colors readable in every theme.
- 321de5d: Honor pi's global and project `enabledModels` settings in session model selection and cycling.
- 3369cc9: **Breaking change — existing projects may need to be trusted again.** PI WEB now always honors Pi's project-trust model and removes the `respectProjectTrust` opt-in environment variable and config key. After upgrading, an existing workspace without a saved trust decision becomes untrusted by default, so its project-local `.pi/` resources — settings, extensions, skills, prompts, themes, `SYSTEM.md`, and `APPEND_SYSTEM.md` — do not load until you trust the workspace or set `defaultProjectTrust` to `always`.

  At session start, project-local `.pi/` resources load only when the workspace is trusted. Trust is resolved the way `pi` resolves it with no browser prompt: a saved decision in the agent directory's `trust.json` wins, a user/global extension may decide through the `project_trust` event (and request that the choice be remembered), and otherwise `defaultProjectTrust` applies. With `ask` or no decision, a workspace is untrusted, matching headless `pi`.

  You can trust a workspace from the new workspace-menu toggle or when adding a project; both link to the project-trust documentation. The trust routes are federated, so the toggle reads and stores the decision on the machine where the workspace runs.

- 6db7a72: Report the Pi coding agent version in use: the Info panel and its diagnostics action now show the Pi version loaded by each PI WEB component (flagging when the session daemon runs a different one), the status/version API exposes it per component, and the `pi-web` CLI version report prints it.
- 5ceeeac: Keep the session bulk-selection toolbar visible while scrolling and use consistent scroll-edge shadows as project, workspace, and session rows pass beneath fixed navigation controls.
- 679a956: Add an Enabled / All models toggle to the session model picker. All-models mode lists the machine's full model catalog — enabled models first — with a per-model checkbox that adds or removes the model from Pi's enabled-models list (the same setting the Pi TUI edits), and search keeps filtering in both modes. Picking a model keeps its current behavior.
- e71cc3c: Improve the model picker's All models view with stable natural row positions and an atomic Select all / Deselect all action. Membership edits now preserve the user's scroll position instead of moving the edited model, and rows change availability without switching models or closing the dialog.
- db0202c: Make the shipped Relay prompts preserve a minimal agreed scope, apply a proportionate quality bar that favors observable and recoverable failure over speculative edge-case automation, plan adaptive context-contained legs instead of a fixed session sequence, carry review dispositions across reviewers, permit explicitly bounded transitional checkpoints, discover each repository's delivery workflow, keep whole-work review report-only, and track structured handoff identifiers durably.
- 1e52e0b: Recognize Relay handoff session names whose leg identifiers contain letters or dashes.
- fb0b28e: Ship Relay as the standalone `@jmfederico/pi-relay` Pi package, sourced from `pi-packages/relays/` and included at `dist/pi-packages/relays/`. Installing the package provides `/relay`, `/relay-worktree`, the `relay` skill, and the Relays PI WEB browser panel/action; Pi package removal removes those package contributions, while `plugins.relays.enabled` only shows or hides the browser panel/action. At session-daemon startup, PI WEB auto-installs Relay for the active agent profile unless that profile previously removed it from **Settings → Pi packages**, and **Available packages** offers one-click reinstall. The shipped path also supports explicit `pi install <path>` outside PI WEB; publishing `@jmfederico/pi-relay` to npm remains deferred.
- b4f68fb: Fix `pi-web restart` on macOS reporting success while LaunchAgents could disappear: the CLI now waits for each `launchctl bootout` to finish unloading before re-bootstrapping the service instead of racing launchd's asynchronous teardown, and the install path settles the same way. `pi-web start` and `pi-web restart` now also verify on macOS and Linux that each service is actually running and responsive (web/API endpoint, session daemon health), exiting nonzero and naming the unready service instead of succeeding silently. These readiness checks and `pi-web doctor` automatically use the custom config path persisted by `pi-web install --config` unless the command is invoked with a nonempty `PI_WEB_CONFIG` override, and fail safely when the service manager has a conflicting loaded definition; malformed systemd environment entries are rejected without stalling lifecycle commands.
- 5d40701: Synchronize global enabled-model selections across active sessions without requiring sessions to be reopened, while keeping workspace `.pi/settings.json` overrides isolated and read-only in the picker.

## 1.202608.1

### Upgrade warnings

- **Browser plugin API v1 → v2:** browser plugin entries must now declare `apiVersion: 2`; v1 entries are rejected without a compatibility shim. The deprecated browser-v1 aliases were removed: use `refreshWorkspacePanels()` with `onInvalidate()`, the provider-authored `workspace.label`, and `workspace.provider.metadata` instead of `isGitRepo`, `isGitWorktree`, or top-level `workspace.branch`. The `plugin-api/unstable` package export is gone, and browser packages must declare a safe `browserRoot` with canonical relative module paths. The server plugin API stays on v1. Update any installed browser plugins when you update PI WEB.
- **Federated deployments must upgrade together:** machine federation breaks across versions in both upgrade orders. The workspace listing route now answers with a provider resolution object, so an older gateway cannot open any project on an updated machine and an updated gateway cannot open any project on an older machine (the machine still reports online and its settings, files, terminals, and sessions still load). Older gateways also lose Git status/diff on updated machines, and workspace deletion requires a host-issued confirmation from the same release. Upgrade gateways and remote machines together, then manually restart `pi-web-sessiond.service` on each target and reload the browser — a web/API restart alone is insufficient.
- **Requires Pi Coding Agent `>=0.84.0`:** update Pi before updating PI WEB.
- **Breaking configuration change:** the `agent.command` config key and `PI_WEB_AGENT_COMMAND` no longer do anything, and `PI_WEB_AGENT_DIR`, `PI_WEB_AGENT_SESSION_DIR`, and `agent.dir` are deprecated aliases of `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`. Deprecated inputs still work in this release but show a non-dismissable UI warning and will be removed in a future release — rename the environment variables and delete `agent.*` from your PI WEB config now.
- **Restart the session daemon after upgrading** on every machine: the machine status indicators, the new subsessions default, and the Pi runtime changes only take effect with a session-daemon restart.
- **Tracked subsessions are now enabled by default:** agents receive the `spawn_subsession` / `list_subsessions` / `check_subsession` / `read_subsession` / `yield_to_subsessions` tools out of the box. Set `subsessions: false` or `PI_WEB_SUBSESSIONS=0` to opt out.

### Patch Changes

- 676815f: Keep `PI_CODING_AGENT_SESSION_DIR` visible to agent processes: when a deployment overrides the session storage directory, `pi` CLIs started from sessions, terminals, and subsessions now use the same session store as the session daemon instead of silently falling back to the default store.
- 180d71a: Send a provider login prompt or selection only once: pressing Enter again, or choosing another option, while the previous response is still being sent no longer submits a duplicate response that could lose the race and report an expired login request. Cancelling the login stays available while a response is in flight.
- 4471e80: Add semantic colors to session-tree kind badges so conversation entry types are easier to distinguish.
- d388375: Keep the session selection toolbar compact by showing the selected count in the clear action and right-aligning bulk session actions.
- 71f0eab: Allow subscription (OAuth) login and logout for federated remote machines from the gateway web UI. Provider discovery, login flows, and credential removal stay bound to the machine where the operation began, even if the selected machine changes while a request is pending. Older pending provider lookups cannot replace or close a newer login/logout dialog or flow. The dialog explains that the provider's redirect page will not load in your browser so you can paste the full redirect URL back to complete the login.
- 42ee6ed: Fix workspace (worktree) removal failing immediately with "Failed to start workspace removal: HTTP request cancelled". A request carrying a body is no longer mistaken for a disconnected client after its body has been read.
- 2dc27b7: Keep error messages readable. The error banner now stays until you dismiss it with its new dismiss button, another message replaces it, or the action that raised it clears it, instead of being wiped by an unrelated background refresh.
- 109ea72: Make the working, terminal, and unread indicators in the machine, project, and workspace lists reliable. Each machine's session daemon now decides which projects and workspaces a running session or terminal belongs to and publishes one status snapshot for the whole machine, so the browser shows the same state everywhere instead of matching directories on its own. Indicators for a machine appear once that machine runs a PI WEB version with this change and its session daemon has been restarted.
- 327df80: Give the web UI's custom overlay dialogs (authentication, settings, session cleanup, command picker, action palette, project/machine dialogs, and the session tree navigator) a shared modal surface: dialogs now take focus when opened, Escape and backdrop presses close them consistently, Tab focus stays trapped inside the dialog, and focus returns to the element that was focused before the dialog opened—even when stacked dialogs close out of order. Global application shortcuts pause while a dialog is open. The authentication dialog also supports ArrowUp/ArrowDown/Enter navigation through its option lists, matching the action palette. In the session tree navigator's second step (continuing or forking from a selected entry), a backdrop press now steps back to the tree — matching Escape — instead of closing the dialog outright.
- d8253a0: Upgrade the bundled Pi coding agent to 0.84.1 and require Pi Coding Agent `>=0.84.0`, so update Pi before updating PI WEB. Pi 0.84 makes provider logins, logouts, and catalog refreshes local-only and cancellable by default, so PI WEB no longer forces offline mode while creating its shared model runtime; bounded network catalog refreshes remain confined to the background refresher.
- 0085967: Always run sessions on the bundled Pi runtime and resolve Pi's agent state directory from Pi's own environment variables. **Breaking configuration change:** the `agent.command` config key and the `PI_WEB_AGENT_COMMAND` environment variable no longer do anything (they never replaced the embedded runtime), and `PI_WEB_AGENT_DIR`, `PI_WEB_AGENT_SESSION_DIR`, and the `agent.dir` config key are now deprecated aliases for `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`. Deprecated inputs are still honored for this release and surface a non-dismissable warning in the UI that names each input and its replacement and clears once you remove them; support will be removed in a future release. Migrate by renaming the environment variables to their `PI_CODING_AGENT_*` equivalents and deleting `agent.*` from your PI WEB config. `pi-web doctor` and the status/update flow now probe the `pi` command on `PATH` directly, and the session daemon exports the resolved state directory to everything it starts, so terminals, the bash tool, and agent-started `pi` processes all use the same directory as your sessions.

  Starting a second PI WEB instance against state owned by a live instance now fails loudly at startup with an actionable error naming the owner and the distinct `PI_WEB_DATA_DIR` / `PI_WEB_SESSIOND_SOCKET` / ports to set, instead of silently sharing state. Sessions carry `PI_WEB_SESSION=1` and receive environment facts explaining they run nested inside PI WEB, including the precautions for running another instance and for restarting services (web before sessiond); agent-spawned processes now inherit the daemon's `PI_WEB_*` environment, and the startup environment scrub removes only `NODE_ENV` and `PORT`.

  Restart the session daemon after upgrading.

- a625a43: Add safe inline workspace file previews for images, HTML, PDF, and rendered Markdown, plus attachment downloads for other files. Text-based formats (HTML, Markdown, and SVG) open as raw source and offer a Raw/Preview control; the chosen mode is remembered on this device, carries across files, and travels in the URL so shared links and browser Back/Forward restore the recorded view.
- fbe6cf9: Add a two-step session tree flow that first selects a history entry, then either continues from it in the same session or forks it into a separate session while leaving the original unchanged. Forking works for local and connected machines; user messages fork from before the entry and restore their text, when present, as the new session draft.
- 568c205: Keep cached session-list rows consistent with the transcript files they describe. When a session file has changed, its row is now rebuilt from a complete pass over that file instead of folding only the newly appended lines onto state kept from an earlier pass, so a row can no longer keep showing details that were overwritten earlier in the file. Unchanged files are still not re-read at all, and message bodies that cannot affect a row are still skipped without being decoded or parsed. This has a cost worth stating plainly: since 1.202608.0 a changed file was re-read only from its previous end, so refreshing a workspace while one of its sessions is actively being written now re-reads that whole transcript rather than just its new tail.
- c9aee67: Tracked subsessions now always run in the working directory of the session that spawned them, so a tracked child always appears in its parent's session tree instead of possibly landing in a workspace where you would not see it. `spawn_subsession` no longer takes a `cwd` parameter, and a request to start a tracked child in a different directory is refused with an explanatory error rather than quietly started somewhere else. To get work done in another workspace, either tell the child to work there, or use `spawn_session`, which can still start an independent session in any project workspace.
- bc4cad9: Enable tracked subsessions by default. Agents now receive the `spawn_subsession`, `list_subsessions`, `check_subsession`, `read_subsession`, and `yield_to_subsessions` tools out of the box; set the `subsessions` config key or the `PI_WEB_SUBSESSIONS` environment variable to `false` to opt out. Tracked subsessions still require `spawnSessions` (also on by default). Restart the session daemon after upgrading for the new default to apply.
- 989439a: Add trusted server-backed workspace provider plugins. Bundled Git now uses the same public lifecycle, claim, JSON backend, removal, federation, and diagnostics contracts available to installed third-party providers; PI WEB ships no replacement integration. Manage desired state per selected machine, and recover offline with `pi-web plugins disable` or `pi-web plugins safe-start ...` (`serverPlugins.safeStart`, including `bundled-only` and `none`).

  Machine federation breaks across versions in both upgrade orders, so upgrade gateways and remote machines together. The workspace listing route now answers with a provider resolution object instead of a workspace array, so workspaces do not load at all across a version mismatch: an older gateway cannot open any project on an updated machine, and an updated gateway cannot open any project on an older machine. The machine still reports online and its settings, files, terminals, and sessions still load, so the failure appears only once a project is selected. Workspace deletion also requires a host-issued confirmation from the same release, older gateways can no longer read Git status/diff from updated machines because the legacy core Git routes are gone, and newer gateways withhold all remote plugin contributions from older targets that lack the versioned lifecycle contract. After upgrading each target, manually restart `pi-web-sessiond.service`, then reload the browser; a web/API restart alone is insufficient. Restarting sessiond may interrupt active sessions/runtime ownership.

  Adopt browser plugin API v2 while keeping the server plugin API on v1. Browser entries must set `apiVersion: 2`; v1 entries are rejected without a compatibility shim. Activation now exposes stable source `pluginId` separately from host-unique `runtimePluginId`. Remove the deprecated browser-v1 aliases: use `refreshWorkspacePanels()` with `onInvalidate()`, use the provider-authored `workspace.label` for generic presentation, and read provider details from `workspace.provider.metadata` instead of `isGitRepo`, `isGitWorktree`, or top-level `workspace.branch`.

  Make the two supported type-only package exports self-contained for strict external TypeScript consumers and remove the former `plugin-api/unstable` path. Browser packages must declare a safe `browserRoot` and canonical relative module paths; only files inside the root are served, with both `.js` and `.mjs` receiving executable JavaScript MIME types. Ship a standalone dual-entry workspace-provider example and updated migration, identity, metadata, signal, removal, asset-boundary, and packaging guidance.

- f24b9a8: Session trees now cover only the workspace you are viewing. Opening a workspace's session list no longer reads session files from your other worktrees, so listing stays fast no matter how many sibling worktrees exist or how busy they are. Three things go away with it: a session's row no longer counts child sessions started in other workspaces, a session whose parent lives in another workspace no longer names that workspace, and it no longer offers "Go to parent session". Such a session now appears as an ordinary top-level row with a dimmed `↳` marker (hover text: "Parent session is not available in this workspace"). Parents and children in the same workspace are untouched — they still nest, indent, and detach exactly as before.

## 1.202608.0

> [!WARNING] > **Breaking change:** Compatibility with older PI WEB runtimes has been removed. Upgrade every remote machine first, then the gateway, so every machine and the gateway run `1.202608.0` together. This release also requires Pi Coding Agent 0.83.0 or newer.

### Patch Changes

- f716f65: Keep the session daemon's own runtime environment out of agent processes: agent shells, terminals, and spawned sessions no longer inherit keys such as `NODE_ENV=production` or `PI_WEB_DATA_DIR`, so commands like `npm install` behave normally inside sessions and a second PI WEB instance started from a session no longer picks up the live daemon's data directory or socket.
- c09b67d: Show the thinking level in assistant chat bubble metadata next to the model and timestamp, for both history and live messages. Bubbles from turns with thinking off stay unchanged.
- 8163d08: Drop all backwards-compatibility gates for older PI WEB runtimes. This release is incompatible with older components: upgrade every remote machine first, then the gateway, so all machines and the gateway run the new version together.

  Also fixes the session daemon staleness check: a session daemon running an older version than the installed package is now correctly reported as stale, so the restart reminder fires as intended.

- b9d3634: Speed up session listings and opening persisted sessions in projects with large session histories. The session daemon no longer parses every session transcript on each request: listings use a lightweight summary scan with an incremental cache that only re-reads newly appended transcript data, and opening a session no longer triggers redundant full-workspace scans.
- 233fd90: Navigation panel sections now share the panel height equally: collapsing a section (such as Projects) distributes its space to all remaining expanded sections instead of only the session list growing.
- ff7a06e: Show nested relay documents in the Relays workspace panel. Folders in a relay packet now appear as chips in the document strip and expand inline (expanding one collapses its siblings); collapsing the folder that holds the open document keeps the selection and highlights the folder. Very deep or large relay trees are listed partially, with a notice.
- Update HTTP server dependencies to patched releases that prevent static-route authorization and path-traversal guard bypasses, request-validation host confusion, and denial-of-service vectors.
- 4bf2be9: Respect the Pi agent profile's `httpIdleTimeoutMs` in the session daemon so long model responses (e.g. slow local vLLM backends) no longer fail with "Model response failed: terminated" at the built-in 5-minute HTTP idle timeout; `0` disables the timeout. Restart pi-web-sessiond after changing the setting.
- c2b7cce: Sessions started via `spawn_session` and `spawn_subsession` now inherit the spawning session's thinking level instead of falling back to the pi default, clamped to the child model's capabilities.
- 5f4d813: Let agents pick a model when delegating work: `spawn_session` and `spawn_subsession` accept an optional `model` parameter as an exact `provider/model-id` (an unknown value is rejected; omitting it keeps the inherited model). In the chat composer, typing `#` opens a model completion menu that inserts a `#provider/model-id` reference into the draft, which agents forward as that parameter.
- 7103bfc: Streamline the session list bulk-selection toolbar: the Select visible / Clear visible / Clear buttons are now a single toggle that offers "Select visible" when nothing is selected and "Clear selected" otherwise, and the redundant Done button is gone — selection mode closes from the same ☑ heading button that opened it. "Archive selected" and "Delete selected" are shortened to "Archive" and "Delete". The slimmer toolbar no longer wraps to two lines on narrow sidebars.
- 9ef2649: Upgrade the bundled Pi coding agent to 0.83.0, bringing credential export commands, headless OpenRouter sign-in, Claude Opus 5 on GitHub Copilot, and upstream session and provider fixes. The supported Pi version range is now open-ended (`>=0.83.0`, no upper bound), so you can run newer Pi releases as they come out without waiting for a PI WEB update.
- f927f5d: Run a repo-provided `.pi-web/hooks/worktree-pre-remove` hook before deleting a workspace worktree. When the hook exists and is executable, it runs with the target worktree path before `git worktree remove`; a non-zero exit blocks the removal. See the config reference for the hook contract.

## 1.202607.3

### Patch Changes

- 9191f59: Add an `ask_user` session tool that lets agents post structured question sets as one chat-native browser form. The form uses the transcript's single scroll area, keeps its header visible, and always gives every question a Custom free-text answer with mobile-safe text sizing. Agents end their run while the form waits; users can submit full or partial answers, unanswered questions are reported explicitly, sending an ordinary chat message voids the open form, pending forms survive browser and web/API reconnects, and closed forms remain readable in the transcript. Disable the tool from **Settings → Session daemon**, with `askUser: false`, or with `PI_WEB_ASK_USER=false`.
- 111db63: Let chat markdown tables keep their natural width and scroll horizontally instead of being squeezed into the chat column, making them readable on mobile.
- 5759201: Support Pi extension dialogs in the browser: `ctx.ui.confirm()`, `ctx.ui.select()`, and `ctx.ui.input()` now render as cards inline in the session transcript and resolve with the user's actual answer — including dialogs opened from `session_start` hooks while the session is still starting and from in-flight `tool_call` hooks, which previously resolved `false` immediately despite `hasUI === true`. Answers travel over a dedicated session-daemon channel rather than the prompt queue, so a dialog parked inside a `tool_call` hook cannot deadlock the run. Open dialogs survive browser reloads, the first answer wins across browser tabs, and unanswered dialogs settle safely on run abort, runtime replacement, or timeout. Adds the `extensionDialogsTimeoutMs` config key (default 5 minutes, `0` waits forever) as the unattended-dialog safety valve; dialog support is always on. Other `ExtensionUIContext` surfaces (widgets, status, editor, `custom`) remain unimplemented.
- 8517800: Turn the bundled Info plugin panel into an always-available PI WEB status view: it now shows the running and installed versions, installation kind and path, release state, per-service health, and machine and workspace details from host-provided status, plus a "Copy PI WEB Diagnostics" action that copies a plain-text summary for bug reports.
- 531ccf7: Let an already-known provider extension refresh its own model list after daemon startup. Previously every provider registration made after the global bootstrap was ignored, so a provider that fetched an updated model catalog on session start never had those models appear. A registration is now applied when it matches the provider's recorded startup configuration in every respect except the model list; anything else — a new provider, a changed provider base URL, API key, API type, headers, or auth surface, a native provider registration, or an unregistration — is still ignored to keep project-level provider configuration from leaking between workspaces. Documented the refreshed policy under Pi extension provider baseline in the configuration reference.
- ce4b469: Add action-palette commands for selecting a session's model and thinking level, with support for assigning custom shortcuts in Settings.
- 69b125b: Show cross-workspace session relationships in the session list. A session whose parent lives in another worktree now names that parent's workspace or branch instead of only reporting an unavailable parent, and offers a "Go to parent session" action that switches to the owning workspace and selects the parent. A session with children in other workspaces of the same project now shows how many, so a parent no longer looks childless when its children are not nested beneath it.
- d19fca4: Add `files.listFiles(path)` to the stable plugin API so workspace panel and label plugins can list workspace directory entries on local and federated machines.
- 8517800: Add `state.selectedMachine` to the stable plugin runtime state so plugin actions and other runtime callbacks can read the selected machine's identity, not just workspace panel contexts.
- 87c0998: Add a built-in Relays plugin: a read-only workspace tab (and **Open Workspace Relays** action) that browses `.pi-web/relays/` packets, with a most-recent relay picker, ordered document tabs, sanitized markdown rendering, and truncation notices.
- c3aeef2: Keep the relays panel document tab strip's horizontal scroll position when switching documents, instead of jumping back to the left edge on every tab click.
- 5c3461d: Remove the legacy session archive migration from session daemon startup. Each `PI_WEB_DATA_DIR` data directory is independent: pointing PI WEB at a new data directory starts there with empty registries and no session archives.

  You are only affected if you have session archives created before July 2026 in the default `~/.pi-web` data directory and you newly set a custom `PI_WEB_DATA_DIR`. To carry those archives over, stop PI WEB, then copy `archived-sessions.json` and the `archived-sessions/` directory from the old data directory into the new one.

- 76f292c: Stop the session and workspace lists from re-scrolling to the selected row on live data refreshes, such as message-count updates while a session streams or workspace topology refreshes. The lists now scroll the selection into view only when the selection moves to a different row, an archived session is revealed, a restored session moves back to the current section, or a collapsed section expands.
- 49e7c39: Say what a slow session start is waiting on. While a session is being created or opened, the activity line now names the current startup step — starting the Pi session, or loading session extensions — and adds a note when provider model lists happen to be refreshing at the same time. When nothing can be attributed, the previous generic wording is kept rather than guessing a cause.
- 8af637b: Give every navigation row a single activity indicator that also carries unread state. When sessions beneath a workspace, project, or machine row have unread completions, the row's indicator becomes a static accent ring around the activity dot — or a filled accent dot while idle — instead of a separate dot next to the name. Session rows now surface unread state even while busy or sending, and the "N unread" header and mobile Sessions badge count busy unread sessions too.
- 8af637b: Add "Mark as read" actions for unread sessions: a per-session item in the session row ⋯ menu (shown only for unread sessions) and a bulk "Mark read" button in the multi-select bar that marks every unread selected session as read.
- 4a51503: Add copy buttons to the workspace menu details so the workspace path and branch can be copied to the clipboard with one click, matching the copy affordances already available in chats.
- 8a24a7c: Pick up git worktrees created or removed outside PI WEB without any user action. The selected project's workspace list is re-read whenever the browser tab regains focus or becomes visible, on local and remote machines, keeping the current workspace, session, and scroll position untouched. Worktrees whose checkout directory no longer exists are hidden instead of being offered as selectable workspaces.

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
