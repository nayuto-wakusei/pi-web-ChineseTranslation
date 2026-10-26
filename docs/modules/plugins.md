# 插件与 Pi 包维护

[返回目录](../maintenance.md) · 公开使用契约：[插件指南](../plugins.md)

## 职责与边界

Pi 包提供扩展、技能和提示词；PI WEB 插件提供浏览器贡献与 daemon 后端。安装包、发现插件、配置期望启用、激活运行时是不同阶段。排障先确定失败阶段，不用重装代替定位。

插件是可信代码，不是沙箱。普通宿主会话能力不能因管理会话获双特权而开放；完整特权改变代理工具，不取消插件宿主的 normal-scope 边界。

内置浏览器插件位于 `pi-web-plugins/<id>/`，构建到 `dist/pi-web-plugins/`，与 Pi packages 不同。优先使用文档中的 context helper，而不是直接请求私有 `/api/...`；远端插件贡献、注册及资产加载都必须保留机器作用域。

中文词典集中在 `pi-web-plugins/zh-cn/`。浏览器在首屏及其他插件激活前，使用只依赖网关配置的语言清单初始化翻译；该清单不能依赖 sessiond 或必需终端插件就绪。Node 只加载 JSON 数据。展示调用保留英文回退和命名参数；不得猜测翻译远端响应、用户内容或协议值。公开声明由 `npm run build:plugin-api` 生成。

公开翻译类型归 `src/shared/pluginApiTypes.ts` 所有；公开声明图不能依赖宿主的 `i18n` 实现。修改时同步生成声明基线，并用安装包消费者的类型检查验证公开导入路径，而不只检查源码编译。

## 加载与调用链

```text
Pi 包/本地插件目录
  -> PiWebPluginCatalog（发现、校验）
  -> PiWebPluginService / lifecycle（期望与实际状态）
  -> 浏览器 external/registry（贡献装配）
  -> daemon serverPluginRuntime（能力依赖、start/stop）
  -> pluginBackendRegistry（请求/channel）
```

纯浏览器插件不一定经过后端；双入口必须匹配实际 daemon 快照。发现不能等同执行插件。浏览器激活保持轻量声明式，连接在对应生命周期打开/清理。

浏览器发现先装配 bundled 默认贡献，再装配 installed 覆盖，各组内部保留原发现顺序，模块下载完成先后不改变优先级。必需 Terminal 的失败边界和机器作用域不变；该顺序不允许用网关后端替代远端配对后端。

Pi SDK 开发基线为 `1.3.0`，安装兼容范围以根 `package.json` 的 peer 声明为准。伴随扩展处理 `before_agent_start` 时须先判断事件是否包含 `prompt`；自定义消息触发的启动不能冒充当前请求的用户提示。

SDK/AI 运行时值统一从 `src/piSdk.ts`、`src/piAi.ts` 导入，复用所选 Pi 安装；类型可继续使用公开包。Pi 扩展入口是例外，由 Pi 宿主解析公开 SDK，并通过 `PI_WEB_PI_PACKAGE_DIR` 把宿主安装传给 CLI/服务。不要让项目认证、管理策略或文件变更队列重新加载另一份 SDK。Pi 1.3.0 的 MCP、codemode、tool-search 工厂接入普通与完整特权管理资源；受限管理不加载这些 builtin。旧版 0.86.1/0.87.0 保持无 builtin 的行为；专用 MCP 认证的版本与凭据边界见[认证与模型](auth-models.md#mcp-认证)。

| 所有者 | 不变量 |
| --- | --- |
| 机器配置 | enabled/settings 是期望状态，不等于激活完成 |
| daemon runtime | 依赖能力、实际版本、停止/取消清理 |
| 浏览器 registry | 注册/注销、重复渲染、机器身份 |
| backend/channel | 请求/响应预算、取消传播、scope、连接终止 |
| browserRoot | 内容公开可读，不能放凭据 |

## 浏览器贡献与状态归属

当前公共入口是浏览器 API v5 与服务端 API v5，宿主仍支持浏览器 v4 和服务端 v3。旧类型名兼容保留，不代表旧入口自动获得 v5 的 catalog、作用域 backend、样式或高亮贡献。能力依赖按精确版本解析，浏览器/daemon 的配对状态依据真实 capability 与 revision，不从安装清单猜测已激活后端。

v5 catalog 固定到创建时的机器，只提供脱离内部引用的公开项目、工作区与会话投影。backend 按 machine/project/workspace 选择目标，由宿主重新解析 authority，不信任插件传入的 cwd。普通 catalog 的当前管理 root 排除不代表历史文件已有耐久 scope；媒体与历史限制见[文件与终端](files-terminals.md#会话媒体)。Pi companion 使用公开 backend 桥接，不导入宿主私有服务。

浏览器宿主统一装配应用级面板与工作区面板。应用级面板依附当前机器，即使尚未选择项目、工作区或会话也可存在；工作区面板依附已选工作区。Info 属于应用级面板，文件与终端等工作区资源仍通过所属机器和工作区的上下文访问，不能借用网关或另一机器的资源。

选择由浏览器宿主持有，插件获得不含内部会话路径或消息正文的公开快照。生命周期绑定的 selection 服务在面板关闭时仍可通知基本选择变化；订阅随插件生命周期结束。项目发现服务与 selection 不同：它固定到创建上下文时的机器，只读查询注册项目和目录建议，后续切换机器不改变已保留服务的目标。

提示上下文 chip 由浏览器插件宿主持有，以插件、机器、会话标识及其工作目录隔离，仅存在于当前浏览器内存。面板关闭和导航不清除它，页面重载清除它。提交时将 chip 正文附加到普通提示词；只有服务端接受后才消费该次提交版本，失败保留，发送中的替换版本不被旧响应删除。它不是服务端任务状态，也不赋予插件跨会话发送权限。

公开上下文与贡献契约见 [plugin-api.ts](../../src/plugin-api.ts)；装配与生命周期见[浏览器插件宿主目录](../../src/client/src/plugins/)，发送归属见[会话控制器](../../src/client/src/controllers/sessionController.ts)。

主题/CSS 与语法高亮是浏览器贡献，样式注册和清理由宿主持有，异步高亮应遵守来源、可见性与生命周期。Markdown transformers 在 daemon 的浏览器投影阶段为完成及历史文本派生 `displayText`，不修改 canonical 消息、store、模型输入或审计，也不变更实际 `thinkingLevel`。浏览器继续净化并显示，部分流式文本在完成前不应用变换；用户/模型正文不是中文翻译目标。

核心提供默认布局、共享控件和可选的通用树形组合能力，`custom-ui-codex` 持有可关闭的本地视觉与布局定制，中文化继续由独立语言插件提供。网关的 `ui-presentation` 能力装配可选展示贡献，渲染器只组织宿主提供的命名插槽；导航贡献可请求宿主将原有项目、工作区和会话列表组合为选中分支树。当前选择的数据加载、菜单、信任、权限和业务操作仍归宿主，不迁入插件，也不向插件投影未选中分支的会话内容。编辑器与消息视图在展示切换时保持原有生命周期，导航列表可重新装配。普通与管理视图使用相同展示边界，但只向插件投影当前作用域的标识、显示名称和已授权操作，不开放普通宿主会话连接。展示冲突拒绝激活，渲染失败撤下该插件的展示、样式与主题并恢复默认独立导航列表。公开区域和上下文见[展示契约](../plugins.md#ui-presentation)，生命周期入口见 [uiPresentationRuntime.ts](../../src/client/src/plugins/uiPresentationRuntime.ts) 与[内置展示插件](../../pi-web-plugins/custom-ui-codex/)。

Workflows 同时包含 Pi 提示词资源和浏览器/服务端插件。profile 默认安装保留用户的移除记忆，禁用浏览器集成不等于移除提示词；派发使用当前机器的项目/工作区 authority 与能力，不通过私有路由绕过。详见[公开指南](../plugins.md#workflows)。

## 公开 API 修改步骤

1. 修改源入口 [plugin-api.ts](../../src/plugin-api.ts) 或 [server-plugin-api.ts](../../src/server-plugin-api.ts)，检查 API/capability 版本，不只改调用端。
2. 联动宿主实现和内置插件，保留机器、工作区和管理边界。
3. 运行 runtime、public API 及插件定向测试。
4. `npm run build:plugin-api` 生成声明，不手改 `.d.ts`。
5. 完整 build 后检查 artifact，确认入口、依赖和资产可独立发布。
6. 更新[权威插件参考](../plugins.md#agent-development)；服务端变更手动重启 daemon，再刷新浏览器。

插件只从公开包入口导入。宿主私有服务、路由与 dist 内部文件不是受支持 API。精确签名、限额和版本只在权威参考维护，不在本页复制。

## 内置模块维护地图

| 模块 | 源码入口 | 易漏回归 |
| --- | --- | --- |
| Git | [server-plugin](../../pi-web-plugins/git/server-plugin.ts)、[browser plugin](../../pi-web-plugins/git/browser/pi-web-plugin.ts) | 提供器目录、删除计划、缓存、远端后端 |
| 文件 | [FilesRuntime](../../pi-web-plugins/files/FilesRuntime.ts) | 预览/源码模式、异步加载、关闭清理 |
| 终端 | [TerminalFacade](../../pi-web-plugins/terminal/TerminalFacade.ts) | 必需能力、PTY、复制、断线和重复绑定 |
| 任务 | [taskRunner](../../pi-web-plugins/workspace-tasks/taskRunner.ts) | 严格配置、确认、命令目标 |
| Mermaid | [mermaid-engine](../../pi-web-plugins/mermaid/mermaid-engine.ts) | 手动模式、隔离、禁止网络、失败保留源码 |
| 信息 | [pi-web-plugin](../../pi-web-plugins/info/pi-web-plugin.ts) | 无工作区状态、目标机器、可选工作区 |
| 更新 | [updatesLogic](../../pi-web-plugins/updates/updatesLogic.ts) | 有效 profile、实际版本、正确重启建议 |
| Relay | [package.json](../../pi-packages/relays/package.json) | 普通自动安装/移除记忆与管理 Skill 同步分离 |
| Captain's Log | [行为说明](../../pi-packages/captains-log/docs/usage.md) | 可选安装、独立派生会话、源会话不变、模型费用 |

## 排障与验证

入口不存在查 catalog/包声明；不可用查 enabled、兼容性、实际 daemon 和依赖能力；面板请求失败查 backend/channel/目标机器。不要静默用网关同名插件替代远端后端。

服务端插件阻塞可影响所有 daemon 会话，超时不能强杀同步阻塞代码。离线禁用和 safe-start 用于恢复，不绕过必需能力长期运行。见[运维](../admin/operations.md)。

- [pluginPublicApi.test.ts](../../pi-web-plugins/pluginPublicApi.test.ts)：公开入口约束。
- [serverPluginRuntime.test.ts](../../src/server/plugins/serverPluginRuntime.test.ts)：生命周期与能力。
- [pluginBackendRegistry.test.ts](../../src/server/plugins/pluginBackendRegistry.test.ts)：后端绑定。
- [machinePluginLoadCoordinator.test.ts](../../src/client/src/plugins/machinePluginLoadCoordinator.test.ts)：跨机器加载与旧结果。

各插件目录的测试验证用户可观察行为。真正发布还需构建、artifact 和 Linux 干净安装，源码 import 成功不证明发布资产完整。
