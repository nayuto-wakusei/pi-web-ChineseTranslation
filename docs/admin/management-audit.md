# 管理嵌入与审计

[返回文档目录](../maintenance.md) · 前置：[认证与模型](../modules/auth-models.md)

## 维护契约

**职责**：网关验证外部管理身份，daemon 消费可信转发上下文，按模式组装受控或普通工具，同时保持资源授权与内容审计隔离。

改动路线：managementEmbed/managementPrivileges → sessionProxyRoutes 的 context 转发 → PiSessionService 的运行时构造 → managementAgentTools/managementSandbox 或普通 SDK 路径。Workbench 的 gatewayIntegration 缓存并发 bootstrap，accessStateStore 管理服务端授权，workbenchTools 与 skillSync 消费固定资源；审计另由两个 store 分流。

维护时逐项检查：普通模式、默认受限、单特权、双特权；HTTP 和 WS；父会话和子会话；工具注册与权限策略中的名称集合。不要仅改 UI 或 tools.allow 列表。完整特权忽略管理 allow/deny，但不能丢管理审计、项目归属或认证隔离。

测试应注入上游客户端和审计传输，不把真实 token 写 fixture。bootstrap 要覆盖同 token 并发复用、失败重试；资源续期要覆盖旧修订不覆盖新修订。沙箱真实隔离另在 Linux 验收。改 daemon 工具/审计必须手动重启；跨进程协议/配置同步重启两端。

## 何时阅读本篇

本篇面向将 PI WEB 嵌入外部工作台的平台集成方。普通模式使用者通常不需要配置 Workbench，也不应为了“限制普通代理”直接套用管理嵌入策略。完整配置字段与环境变量仍以[Workbench 配置](../config.md#workbench-and-mcp-integration)为准。

## 请求链路与身份

```text
平台签名入口 -> Web 网关验证/约束 -> daemon 管理上下文
                      -> Workbench 私有 Agent Session
                         -> 固定资源、能力、知识和 Skill 授权
```

网关验证入口身份后把管理上下文传给 daemon，不能只在浏览器隐藏按钮。会话、HTTP 修改、WebSocket、独立会话和子会话都必须保留该上下文。工作区也必须在授权项目范围内。

受限与完整特权管理嵌入共用浏览器启动流程。入口没有项目、工作区或会话目标、当前为本机且授权项目列表成功加载后，若恰有一个项目，浏览器自动进入该项目，并复用既有工作区选择流程；多个项目时不任意选择。显式资源链接及加载期间发生的后续导航优先，自动进入不能覆盖这些目标，也不改变项目授权或权限模式。

管理模式的会话自动选择与恢复仅以服务端当前列出的会话为候选，不使用仅存于浏览器的空会话缓存或指向这些缓存的记忆选择。显式会话目标和手动选择保持既有行为；浏览器缓存、未发送草稿与附件不会因此删除。

管理项目没有提供者允许删除的工作区、且浏览器未跟踪该项目的删除任务时，浏览器跳过删除命令运行记录的发现查询；已有跟踪任务仍继续刷新。这些浏览器端规则不扩大管理权限，也不引入服务端回退。

管理嵌入与普通模式的工作区列表共用 [WorkspaceProviderResolution](../../src/shared/apiTypes.ts) 响应结构：`status`（`provider`、`folder` 或 `degraded`）、`projectId`、可选 `ownerPluginId`、`workspaces` 和 `diagnostics`，每个工作区带有效配置。网关仍先验证管理身份与授权项目，再携带管理上下文解析工作区；共用响应结构不扩大授权范围。浏览器保持同一结构校验，提供者降级时保留状态与诊断，不将响应简化为裸工作区数组或静默忽略解析失败。

管理项目初始化只在 `AGENTS.md` 缺失时创建签名指令，不替换已有文件。当前工作区的指令确认由网关持有，复核管理身份、项目及工作区授权后，才保存“不覆盖”决定或执行备份与覆盖；确认状态属于托管数据，不是核心配置。浏览器只关闭菜单不会确认版本，过期决定返回 `409`，不能静默覆盖刚修改的文件。完整交互及公共能力见[管理工作区指令](../plugins.md#managed-agents-review)。启用此确认流程需同时更新 Web/API 与 daemon 并安排重启，避免旧 daemon 继续执行自动覆盖；保存文件不承诺运行中的模型即时重新加载已缓存指令。

Workbench 适配器在服务端保存访问状态及票据，以不透明 handle 联系 daemon；相同 entry token 的并发 bootstrap 复用同一 Agent Session。平台入口过期或资源授权失效时，应按提示回工作台重新进入，而不是复制旧票据到普通页面。

entry token 交换为私有 Agent Session 后，access/capability tickets 必须留在服务端，只加载已授权的固定资源与 Skill 版本，并仅暴露受控能力工具。Workbench 集成与管理审计构造跨越网关和 daemon，两端使用相同有效 endpoint 与限额；这些配置或转发协议变化时重启两端。

模型认证和默认偏好独立于普通模式。即使完整特权开启，管理会话也仍是管理身份，不能由普通会话或普通宿主插件连接读取。

专用 MCP OAuth 仅在 Pi 1.3.0 普通或完整特权会话中可用；完整特权仍使用管理独立凭据，不借用普通项目或共享 agent 的 MCP OAuth 存储。媒体读取同样保持管理 scope，管理端仅读取已托管会话；普通媒体及插件 catalog 排除当前配置的管理 root。历史文件无耐久 scope、旧管理 root 需人工隔离的限制见[会话媒体](../modules/files-terminals.md#会话媒体)，不能扩展为全部历史 API 已自动隔离的承诺。

## 三种权限状态

| 状态 | 成立条件 | 代理实际能力 |
| --- | --- | --- |
| 默认受限 | 未开启机器特权开关，或无有效特权授权 | 受控文件工具、隔离 Python/bash、授权 Workbench 工具；默认无网络 |
| 单项特权的受限模式 | `allowPrivileged` 开启，签名只授予 bash 或 network | 在受限框架内扩展对应能力，显式工具 allow/deny 继续生效 |
| 完整特权管理 | `allowPrivileged` 开启，签名 bash 与 network 都为 true | 普通 SDK 工具与资源加载；忽略管理 token 的 tools.allow/deny |

普通模式保持既有、不受管理机制限制的工具和资源行为；Workbench 资源、能力控制、Skill 同步、沙箱及外部托管权限仅用于受限管理会话，不能成为普通或完整特权的默认值。

受限模式使用 managed file tools 和自定义 `python`，Python 经 Bubblewrap 保持 workspace-only 隔离，默认无网络。默认受限 bash 也在 Bubblewrap 中执行：除必要只读运行路径外，仅当前工作区可见且可写，默认无网络。通用 SDK shell、PowerShell、terminal、MCP、HTTP、web-fetch、web-search 默认拒绝。

单项签名 `privileged.bash`/`privileged.network` 仅在 `managementEmbed.allowPrivileged` 为 true 时生效。bash-only 可扩大宿主只读可见性；network-only 允许已安装的 `http`/`webfetch`/`websearch` 工具，并移除受控 bash/Python 的网络隔离，但不扩大宿主目录可见性。受限模式的显式工具选择与 deny 仍是最终约束。

完整特权必须同时满足机器 `managementEmbed.allowPrivileged` 与两个有效签名特权，忽略管理 token 的 `tools.allow`/`tools.deny`。必须复用普通 SDK 工具和资源加载机制，不能用扩大只读沙箱或手写“allow all”策略代替。管理项目自动受信任，无需审批，也不能改变普通项目的 trust 决策。

完整特权是高风险信任选择，不是“多开两个工具”的普通授权：它不再使用管理工作区沙箱/资源过滤，不注入受控 Workbench 工具或只读 capability 指令，不要求 Workbench 资源续期，也不创建/覆盖管理 Skill。其权限受 daemon 系统账号及普通策略约束，不等于 root。只给可信入口签发双特权。

完整特权仍保留管理身份、专属 auth/model/偏好 store、内容审计及委派上下文。其提示词排除已知平台托管 AGENTS 指令，包括匹配签名 context 的旧版指令；不能删除共享文件或真正用户编写的指令，保留操作者普通 permission-policy 环境。浏览器交互终端仍有独立授权，不能由上述表格直接推导可用性。宿主插件的会话连接仍限 normal scope，特权不会把管理会话变成普通会话或向普通调用者开放。

全局功能开关启用时，管理会话可获得 `spawn_session`、以 `spawn_subsession` 为首的完整 tracked-subsession 工具集及 `ask_user`。所有独立会话和子会话继承发起者管理 context。受限模式在 Pi permission policy 和 runtime `tools` 中注册完全相同的受控工具名称集合，并遵守显式管理 deny；完整特权在普通 SDK 工具之外保留这些有作用域的工具。

## 能力、知识与 Skill

受限代理先通过 `icnoc_search_capabilities` 查找授权能力，再用 `icnoc_call_capability` 调用，不能把资源名替换为未授权 ID。能力服务自身的授权不会因为 PI WEB 模式切换而消失。

知识读取流程：

1. `workbench_search_knowledge` 查找授权资源元数据。
2. 使用返回的精确 `resourceName`；RAGFlow 走 `workbench_retrieve_knowledge`，BookStack 走 `workbench_retrieve_bookstack`。
3. 阅读返回文本及引用。BookStack 是授权已发布书籍的当前非草稿页检索，不提供编辑，也不能描述为通用语义搜索。
4. 遇到 `truncated` 时说明结果有限，不把它当作完整知识库；凭引用和修订判断来源。

PI WEB 不配置这些知识服务的后台账号，不接受任意 tenant/dataset ID 越过授权；短期知识票据由后端处理。知识来源 URL 是引用，不是连接配置。

Skill bundle 按授权固定版本与 manifest 验证，从配置 MCP origin 下载后同步到管理工作区 `.pi/skills/`。受限启动强制同步 `relay` 和 `relay-runner` 模板到 `.pi/skills/<name>/SKILL.md`，只替换所属工作区内的同名内容；因此不要把它们作为自定义内容的唯一副本。两个模板都必须纳入 npm 包和 Workbench Skill allowlist。普通与完整特权启动既不创建也不覆盖这些项目 Skill。

安装并启用接力包且允许委派时，受限会话的 `dispatch_relay` 通过派发桥接创建继承管理 context 的独立后继会话，保持同项目工作区授权和普通插件的会话访问边界；显式 deny 或关闭委派仍生效，不以通用 `spawn` 替代，见[接力指南](../plugins.md#接力)。

完整特权启动及 `/reload` 清理确认原样下发的项目 Relay 副本，由已启用的内置包提供技能。仅匹配当前模板或已知历史模板，目录必须只有普通文件 `SKILL.md`；修改过的副本、额外文件、符号链接和其他自定义 Skill 均保留，真实冲突照常报告。同步与清理共用稳定的 `.pi/skills` 目录队列，清理不得递归删除。普通模式不清理；取消特权并通过新的授权入口进入受限会话后，恢复受限模式的模板同步。权限与沙箱规则不因清理改变，完整生效条件见[配置参考](../config.md#workbench-and-mcp-integration)。

仅当项目副本与已知 bundled 副本内容完全相同时，才能抑制对应 Relay Skill 的 collision；此规则分别适用于两个 Skill，不能压制其他诊断或削弱管理资源隔离。

## 审计分流

| 通道 | 内容 | 存储与用途 |
| --- | --- | --- |
| 普通工具调用 | 会话/cwd、工具与 call ID、状态、时间、耗时 | SQLite；不保存提示词、参数、结果、模型回复 |
| 管理会话内容 | 用户文本、可见回复（排除 thinking）、工具参数/结果及身份 | 启用后的 Elasticsearch 周索引；`content` 存储但不索引 |
| Workbench 专项事件 | 固定资源版本、授权修订、run/trace、状态等元数据 | 管理审计；同一次调用的工具正文仍按工具审计记录 |
| 服务日志 | 运维元数据与错误 | 不应额外输出认证令牌或正文副本 |

普通 SQLite 默认开启，管理 Elasticsearch 需要配置开启。管理调用不混入普通 SQLite。审计中的会话正文可能天然包含用户粘贴的敏感数据，“不添加认证状态中的 token 字段”不等于正文已经自动脱敏，应限制 ES/Kibana 的访问权限。

普通工具审计保留现有结构化服务日志，并写入 `$PI_WEB_DATA_DIR/audit/normal-tool-calls.sqlite` 的纯元数据记录；普通存储和服务日志都不得持久化 prompts、arguments、results、model replies、tokens、credentials、cookies 或 tickets。

受限和完整特权管理会话都保留 user、root-user、project、session、Workbench Agent Session 身份，以及 `content` 中的用户文本、排除 `thinking` 的可见 assistant 消息和工具参数/结果。管理服务日志保持 metadata-only；专门的 Workbench capability、knowledge、Skill 审计事件也只记元数据。不得把认证状态中的 tokens、credentials、cookies、tickets 额外加入审计字段。

审计失败记录错误但不停止工具/会话，因此“任务成功”不证明审计已送达；ES 有界队列、重试和优雅关闭刷写也不构成无丢失保证。存储位置、保留期、索引规则与 CLI 示例分别见[普通审计](../config.md#ordinary-mode-tool-audit)和[管理审计](../config.md#management-mode-elasticsearch-audit)。

队列 Recall/切换等重建操作不把已接收的保留消息重复记为新输入；浏览器 Markdown 派生显示也不替换审计原文。普通服务日志仍只记录运维元数据，不能将认证交互或聊天正文作为恢复诊断字段。

## 集成验收清单

1. 对齐 Web/daemon 的管理、Workbench/MCP、审计配置并重启需要的进程。
2. 用测试身份从平台进入，核对用户、项目及工作区；同 token 并发请求不应创建多份 Agent Session。
3. 在受限 Linux 环境验证工作区外写入拒绝、默认网络隔离、显式 deny 和授权资源版本。
4. 分别验证仅 bash、仅 network、双授权，特别确认完整特权不能靠 token tools.deny 继续限制。
5. 生成测试子会话，验证管理上下文与模型存储隔离；普通入口不能读取它。
6. 发起无敏感内容的测试调用，在对应审计存储检查身份、工具状态及正文规则。
7. 测试过期/撤销、上游暂时失败、Skill 校验失败，并检查错误不会泄漏票据。

以上需要真实 Linux/Bubblewrap、平台签名、Workbench/MCP 与 ES 测试环境。Windows 单元测试只能证明相应分支和契约，不能替代沙箱或端到端授权验收。

## 实现与回归入口

- 入口与权限：[managementEmbed.ts](../../src/server/managementEmbed.ts)、[managementPrivileges.ts](../../src/server/managementPrivileges.ts)、[权限测试](../../src/server/managementPrivileges.test.ts)。
- bootstrap：[gatewayIntegration.ts](../../src/server/workbench/gatewayIntegration.ts)、[并发测试](../../src/server/workbench/gatewayIntegration.test.ts)。
- 资源与知识：[workbenchTools.ts](../../src/server/workbench/workbenchTools.ts)、[skillSync.ts](../../src/server/workbench/skillSync.ts)。
- 沙箱：[managementSandbox.ts](../../src/server/sessions/managementSandbox.ts)、[完整特权测试](../../src/server/sessions/piSessionService.privilegedManagement.test.ts)。
- 审计：[normalToolAuditStore.ts](../../src/server/audit/normalToolAuditStore.ts)、[managementAuditStore.ts](../../src/server/audit/managementAuditStore.ts)、[会话审计测试](../../src/server/sessions/piSessionService.audit.test.ts)。
