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

Workbench 适配器在服务端保存访问状态及票据，以不透明 handle 联系 daemon；相同 entry token 的并发 bootstrap 复用同一 Agent Session。平台入口过期或资源授权失效时，应按提示回工作台重新进入，而不是复制旧票据到普通页面。

模型认证和默认偏好独立于普通模式。即使完整特权开启，管理会话也仍是管理身份，不能由普通会话或普通宿主插件连接读取。

## 三种权限状态

| 状态 | 成立条件 | 代理实际能力 |
| --- | --- | --- |
| 默认受限 | 未开启机器特权开关，或无有效特权授权 | 受控文件工具、隔离 Python/bash、授权 Workbench 工具；默认无网络 |
| 单项特权的受限模式 | `allowPrivileged` 开启，签名只授予 bash 或 network | 在受限框架内扩展对应能力，显式工具 allow/deny 继续生效 |
| 完整特权管理 | `allowPrivileged` 开启，签名 bash 与 network 都为 true | 普通 SDK 工具与资源加载；忽略管理 token 的 tools.allow/deny |

默认受限模式并非完全没有 bash：它可在 Bubblewrap 隔离的工作区中执行，工作区可写、必要运行库只读，默认无网络。单项 bash 特权可扩大宿主只读可见性；单项 network 特权不自动扩大宿主目录可见性。

完整特权是高风险信任选择，不是“多开两个工具”的普通授权：它不再使用管理工作区沙箱/资源过滤，不注入受控 Workbench 工具，不以资源续期阻止代理启动，也不强制同步管理 Skill。其权限受 daemon 系统账号及普通策略约束，不等于 root。只给可信入口签发双特权。

完整特权仍保留管理身份、专属模型认证/偏好、内容审计及子会话上下文。平台标记的管理 AGENTS 指令不会进入其提示词，但不删除文件或用户自写指令。浏览器交互终端仍有独立授权，不能由上述表格直接推导可用性。

## 能力、知识与 Skill

受限代理先通过 `icnoc_search_capabilities` 查找授权能力，再用 `icnoc_call_capability` 调用，不能把资源名替换为未授权 ID。能力服务自身的授权不会因为 PI WEB 模式切换而消失。

知识读取流程：

1. `workbench_search_knowledge` 查找授权资源元数据。
2. 使用返回的精确 `resourceName`；RAGFlow 走 `workbench_retrieve_knowledge`，BookStack 走 `workbench_retrieve_bookstack`。
3. 阅读返回文本及引用。BookStack 是授权已发布书籍的当前非草稿页检索，不提供编辑，也不能描述为通用语义搜索。
4. 遇到 `truncated` 时说明结果有限，不把它当作完整知识库；凭引用和修订判断来源。

PI WEB 不配置这些知识服务的后台账号，不接受任意 tenant/dataset ID 越过授权；短期知识票据由后端处理。知识来源 URL 是引用，不是连接配置。

Skill bundle 按授权固定版本与 manifest 验证，从配置 MCP origin 下载后同步到管理工作区 `.pi/skills/`。受限启动同时同步 `relay` 和 `relay-runner`，可能覆盖所属工作区的同名模板，因此不要把同名路径作为自定义内容的唯一副本。普通与完整特权启动不执行这种强制覆盖。

## 审计分流

| 通道 | 内容 | 存储与用途 |
| --- | --- | --- |
| 普通工具调用 | 会话/cwd、工具与 call ID、状态、时间、耗时 | SQLite；不保存提示词、参数、结果、模型回复 |
| 管理会话内容 | 用户文本、可见回复（排除 thinking）、工具参数/结果及身份 | 启用后的 Elasticsearch 周索引；`content` 存储但不索引 |
| Workbench 专项事件 | 固定资源版本、授权修订、run/trace、状态等元数据 | 管理审计；同一次调用的工具正文仍按工具审计记录 |
| 服务日志 | 运维元数据与错误 | 不应额外输出认证令牌或正文副本 |

普通 SQLite 默认开启，管理 Elasticsearch 需要配置开启。管理调用不混入普通 SQLite。审计中的会话正文可能天然包含用户粘贴的敏感数据，“不添加认证状态中的 token 字段”不等于正文已经自动脱敏，应限制 ES/Kibana 的访问权限。

审计失败记录错误但不停止工具/会话，因此“任务成功”不证明审计已送达；ES 有界队列、重试和优雅关闭刷写也不构成无丢失保证。存储位置、保留期、索引规则与 CLI 示例分别见[普通审计](../config.md#ordinary-mode-tool-audit)和[管理审计](../config.md#management-mode-elasticsearch-audit)。

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
