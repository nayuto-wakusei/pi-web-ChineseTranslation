# 认证与模型

[返回文档目录](../maintenance.md) · 前置：[维护者上手](../getting-started.md)

## 维护契约

**职责**：将浏览器访问认证与模型调用认证分开；后者按普通项目或管理模式选择 registry。不得为了简化调用引入隐式全局回退。

调用链：AuthController 固定 AuthDialogTarget → api 的 AuthRequestTarget → 网关转发 → authRoutes → ProjectAuthService/AuthService。普通 cwd 由工作区目录唯一解析；管理 context 选择独立 auth。OAuth 流程必须携带原目标完成整个生命周期。

| 状态 | 生命周期/边界 |
| --- | --- |
| 普通访问登录 | 网关内存会话与配置 passwordHash，与模型 key 无关 |
| 项目初始化 | 按项目路径键串联合并并发初始化；逐文件只复制一次 |
| 模型 registry | daemon 按 owning project 复用；auth change 按 registry 身份广播 |
| OAuth | flow ID 与原目标绑定；当前 UI 选择可变化，不重新定向已开始流程 |
| 默认偏好 | 模式 × 项目托管文件；其他 Pi 设置仍从真实 agentDir 读取 |

认证改动最低覆盖首次复制、已有文件不覆盖、A/B 项目隔离、同项目多工作树共享、歧义 cwd 拒绝及客户端 OAuth 目标传播。请求字段变化同步 shared 类型、parsers 和联邦契约；不要仅测单一项目快乐路径。daemon auth/registry 实现变更需手动重启。

## 三类凭据不能混用

| 凭据 | 解决的问题 | 所有者 |
| --- | --- | --- |
| 普通浏览器访问密码 | 谁能进入普通 PI WEB | 网关的 `normalAuth.passwordHash` |
| 提供商 API key/OAuth | 代理用什么身份调用模型 | 普通模式按注册项目；管理模式独立 |
| 机器令牌/管理入口令牌 | 联邦请求或嵌入平台的授权 | 对应连接/平台，不是模型认证 |

浏览器能登录不表示模型可调用；提供商登录成功也不能代替浏览器访问认证。不要把模型 key 填进机器连接密码，更不要把任何密钥提交到 `.pi-web/config.json` 或文档示例。

## 普通浏览器登录

首次访问按界面设置访问密码，之后用密码登录。密码变更会使旧登录状态失效；Web 进程重启也可能要求重新登录，但不应因此丢失 daemon 中的会话工作。正常访问必须在可信网络或可信代理后，不要把普通模式当多租户隔离平台。

未认证 API 返回登录/初始化要求时，先恢复浏览器登录，不要据此认定 daemon 已停止。认证路由在网关 `/api/normal-auth/...`，与模型提供器的 `/api/auth/...` 不同。

## 为项目配置模型认证

1. 选择将运行任务的机器和已注册项目。
2. 从模型认证入口打开提供商列表，确认对话框目标。
3. 选择提供商，按支持方式保存 API key 或开始 OAuth。
4. OAuth 需要外部授权或交互输入时，按对话框提示完成；取消则终止该授权流程。
5. 回到同一项目查看模型列表，使用测试会话发起短请求确认可用。仅保存 key 不保证配额、网络和模型权限正确。

`AuthController` 在流程开始时将机器和普通模式的项目快照为 `AuthDialogTarget`；异步 OAuth 轮询始终保留原目标，仅当该目标仍被选中才刷新会话状态，不能从可变 UI 选择重新定向流程。认证 API 在普通模式必须提供并验证已注册的 `projectId`；提供器查询、API key 保存/注销及全部 OAuth 生命周期请求均传递类型化 `AuthRequestTarget`。管理请求由转发 context 选择独立 store，不能猜测浏览器当前项目。

注销移除对应认证，不删除聊天记录。环境凭据或可信扩展也可能参与提供器基线，因此“删除存储中的 key”不应被视为撤销所有外部服务授权。

## MCP 认证

MCP 的专用设置/认证流程与模型提供商 OAuth 分开，使用当前会话的 Pi 内置 `/mcp` 命令，不向聊天队列发送认证交互。它仅支持所选 **Pi 1.3.0** 安装的同一 SDK 内部凭据适配，不承诺其他版本内部类兼容。会话须可写、空闲且工作区可信；受限管理不可用，完整特权仍保留管理身份及独立凭据。

认证捕获机器、精确会话、cwd、项目与普通/管理作用域；列表、开始、轮询、回答和取消都重新检查归属，不随浏览器选择改变目标。普通项目使用自己的 MCP 凭据，管理使用独立存储，不回退共享 agent 的 MCP OAuth 凭据。凭据是私有托管状态，不写入 checkout；MCP 服务器配置仍遵循 Pi 的全局/项目设置与信任，不是 Workbench 受控 MCP 授权。配置入口见[配置参考](../config.md#mcp-settings-and-authentication)，流程与凭据边界见 [mcpAuthFlowService.ts](../../src/server/sessions/mcpAuthFlowService.ts) 和 [mcpOAuthCredentialAdapter.ts](../../src/server/sessions/mcpOAuthCredentialAdapter.ts)。

## 项目隔离与首次初始化

普通项目存储位于：

```text
$PI_WEB_DATA_DIR/projects/<sha256(normalized-absolute-project-path)>/
  auth.json
  models.json
  settings.preferences.json
```

同项目的所有 worktree 使用同一存储；不同项目和管理嵌入使用不同存储。路径键由规范化绝对项目路径计算，Windows 上转为小写；不要手工猜 hash 创建目录。

第一次初始化逐文件复制有效全局 Pi agent 的 `auth.json`/`models.json`，源文件不存在才创建空默认值。之后不因全局文件变化而覆盖或回退；已有项目文件是持久状态，不是缓存。因而“全局 Pi 能调用，PI WEB 项目不能调用”时，应检查项目认证，而不是反复修改全局文件。

普通会话在列出、启动或打开 runtime 前，cwd 必须唯一匹配已注册项目的工作区，以此选择模型 registry，不能回退环境中的全局 Pi 凭据。已创建运行时保留创建时 registry；关闭项目不能使它切换到另一个项目认证。auth change 按精确 registry 身份处理，不能刷新或警告其他项目的会话。目录和文件权限按私有存储创建；文件不写入 checkout 或可提交的项目配置，备份、系统账号和磁盘访问仍由运维保护。

## 模型选择与默认偏好

`defaultThinkingLevel`、`defaultProvider`、`defaultModel` 按模式 × 项目保存：普通模式的 `settings.preferences.json` 与项目 auth store 同目录；管理模式使用 `$PI_WEB_DATA_DIR/management-embed/projects/<hash>/settings.preferences.json`，cwd 无法唯一归属注册项目时使用 `management-embed/orphan/<cwdHash>/settings.preferences.json`。普通 `enabledModels` 也按项目存储，因为各项目拥有独立 registry；管理模式隐藏此设置。packages、extensions、proxy 等其他共享设置仍从真实 agentDir 的 `settings.json` 读取，runtime 不得把项目偏好回写到共享全局 agent 目录。

当前会话模型、可用模型目录、启用模型集合、新会话默认值是四个不同概念：

- 点击模型选项：切换当前会话模型。
- 修改启用模型：普通模式中影响该项目的模型选择范围。
- 点击“新会话默认值”星标：保存模式 × 项目的默认 provider/model/thinking，不改变当前会话。
- 恢复已有会话：优先恢复会话原状态，而不是重新套用默认模型。

管理模式不展示普通项目的 `enabledModels`。默认模型还必须可用且启用；默认值、显式启动选择和 Pi 设置的关系见[默认值配置](../config.md#startup-model-and-thinking-defaults)。

模型目录由 daemon 后台刷新，失败保留最后成功结果。重新打开模型选择器可读取新结果。提供器实现/连接基线变更与仅模型列表变更不是一回事，前者通常要求重启 daemon；`/reload` 不能随意重定义提供器。时间参数和离线变量语义见[目录刷新](../config.md#catalog-refresh)。

普通设置页的命名模型目录同样需要设置目标机器上的显式注册项目。设置机器与活动工作区机器不同或缺少该项目上下文时，显示目录不可用，不借用活动会话、其他项目或全局凭据。切换设置目标不切换聊天的项目/工作区/会话；入口见 [SettingsDialog.ts](../../src/client/src/components/SettingsDialog.ts)。

## 自检与排障

| 检查 | 预期 |
| --- | --- |
| A 项目的两个工作树打开认证 | 使用同一项目存储 |
| B 项目首次初始化后，修改 A 认证 | 不改写 B 的已存储认证 |
| OAuth 进行中切换机器/项目 | 完成写回原目标，不串改当前目标 |
| 给新会话默认值加星 | 当前会话模型不变，新会话读取该项目默认值 |
| 恢复旧会话 | 不被新默认值强制替换 |
| 未注册/歧义 cwd 启动 | 明确拒绝，不回退全局凭据 |

生产验证应使用专用测试凭据，避免注销真实工作项目。排障只记录提供器名、目标机器/项目和脱敏错误，不记录 key、OAuth token、授权码或 Cookie。

## 实现与回归入口

- 浏览器访问：[normalAuth.ts](../../src/server/normalAuth.ts)、[normalAuth.test.ts](../../src/server/normalAuth.test.ts)。
- 模型认证：[authRoutes.ts](../../src/server/sessions/authRoutes.ts)、[projectAuthService.ts](../../src/server/sessions/projectAuthService.ts)、[项目隔离测试](../../src/server/sessions/projectAuthService.test.ts)。
- 异步目标：[authController.ts](../../src/client/src/controllers/authController.ts)、[控制器测试](../../src/client/src/controllers/authController.test.ts)。
- 默认偏好：[projectSettingsScope.ts](../../src/server/sessions/projectSettingsScope.ts)、[偏好隔离测试](../../src/server/sessions/piSessionService.settingsScope.test.ts)。
