# 插件与 Pi 包维护

[返回目录](../maintenance.md) · 公开使用契约：[插件指南](../plugins.md)

## 职责与边界

Pi 包提供扩展、技能和提示词；PI WEB 插件提供浏览器贡献与 daemon 后端。安装包、发现插件、配置期望启用、激活运行时是不同阶段。排障先确定失败阶段，不用重装代替定位。

插件是可信代码，不是沙箱。普通宿主会话能力不能因管理会话获双特权而开放；完整特权改变代理工具，不取消插件宿主的 normal-scope 边界。

内置浏览器插件位于 `pi-web-plugins/<id>/`，构建到 `dist/pi-web-plugins/`，与 Pi packages 不同。优先使用文档中的 context helper，而不是直接请求私有 `/api/...`；远端插件贡献、注册及资产加载都必须保留机器作用域。

中文词典集中在 `pi-web-plugins/zh-cn/`。浏览器在首屏及其他插件激活前，使用只依赖网关配置的语言清单初始化翻译；该清单不能依赖 sessiond 或必需终端插件就绪。Node 只加载 JSON 数据。展示调用保留英文回退和命名参数；不得猜测翻译远端响应、用户内容或协议值。公开声明由 `npm run build:plugin-api` 生成。

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

| 所有者 | 不变量 |
| --- | --- |
| 机器配置 | enabled/settings 是期望状态，不等于激活完成 |
| daemon runtime | 依赖能力、实际版本、停止/取消清理 |
| 浏览器 registry | 注册/注销、重复渲染、机器身份 |
| backend/channel | 请求/响应预算、取消传播、scope、连接终止 |
| browserRoot | 内容公开可读，不能放凭据 |

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
| 信息 | [pi-web-plugin](../../pi-web-plugins/info/pi-web-plugin.ts) | 诊断字段、目标工作区 |
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
