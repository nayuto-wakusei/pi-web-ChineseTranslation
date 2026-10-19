# 改动联动与验证地图

[返回目录](../maintenance.md) · 前置：[架构](architecture.md)

## 按改动选择检查

表内是最小起点，不意味着只运行列出的测试就证明全部行为正确。测试从仓库根目录传给 `npm test -- <路径>`。

| 改动 | 必须联动/保留 | 定向回归 | 生效 |
| --- | --- | --- | --- |
| 机器级 HTTP/WS | shared 类型、联邦白名单、本机两套路由、client/parser/socket | [federatedRouteContract](../../src/client/src/api/federatedRouteContract.test.ts)、[localAliases](../../src/server/app.localAliases.test.ts) | 协议变更两端重启 |
| 模型认证 | owning project、AuthRequestTarget、OAuth 固定目标、管理独立 store | [projectAuthService](../../src/server/sessions/projectAuthService.test.ts)、[authController](../../src/client/src/controllers/authController.test.ts) | daemon |
| 默认偏好 | 模式 × 项目、恢复会话不被覆盖 | [settingsScope](../../src/server/sessions/piSessionService.settingsScope.test.ts) | 逻辑升级重启 daemon；用户改值无需 |
| 会话命名 | controller 与 /name、持久/非归档资格、非当前行不切换 | [rename](../../src/client/src/controllers/sessionController.rename.test.ts)、[SessionList](../../src/client/src/components/SessionList.test.ts) | 按修改进程 |
| 树/历史刷新 | selected leaf、异步导航与磁盘读取竞态 | [tree](../../src/server/sessions/piSessionService.tree.test.ts)、[listingFreshness](../../src/server/sessions/piSessionService.listingFreshness.test.ts) | daemon |
| 附件/临时会话 | add/remove/reset、临时到持久 ID 迁移 | [attachmentStaging](../../src/client/src/promptAttachmentStaging.test.ts)、[cachedNew](../../src/client/src/controllers/sessionController.cachedNew.test.ts) | 按修改进程 |
| 滚动布局 | .chat-wrap 约束 flex、.chat absolute inset 0 | [shared](../../src/client/src/components/shared.test.ts)；真实浏览器长记录验收 | UI |
| 轮询/恢复 | 连接世代、旧请求完成检查 | [activityController](../../src/client/src/controllers/activityController.test.ts)、[trailingRefreshCoordinator](../../src/client/src/controllers/trailingRefreshCoordinator.test.ts) | UI |
| 工作区删除 | 提供器、确认前提、钩子先于终端关闭、最终命令状态 | [workspaceRemovalService](../../src/server/workspaces/workspaceRemovalService.test.ts) | daemon |
| 文件/预览 | realpath、符号链接、预算、取消、代理响应头 | [workspaceFiles](../../src/server/app.workspaceFiles.test.ts)、[workspaceFilePreview](../../src/server/app.workspaceFilePreview.test.ts) | Web；共享运行时按依赖 |
| 管理工具/特权 | 网关上下文、daemon 权限、两类模式、子会话继承 | [managementPrivileges](../../src/server/managementPrivileges.test.ts)、[privilegedManagement](../../src/server/sessions/piSessionService.privilegedManagement.test.ts) | daemon；配置两端对齐 |
| Workbench | 并发复用、handle、授权修订顺序 | [gatewayIntegration](../../src/server/workbench/gatewayIntegration.test.ts)、[sessionRenewal](../../src/server/workbench/sessionRenewal.test.ts) | 按修改进程 |
| 审计 | 普通元数据、管理正文排除 thinking、秘密不新增字段 | [audit](../../src/server/sessions/piSessionService.audit.test.ts) | daemon |
| 中文文案 | owning component/plugin、文案断言 | [coreUiChineseCopy](../../src/client/src/coreUiChineseCopy.test.ts) | 按修改进程 |
| 插件 API/包 | 源入口、生成声明、宿主共同契约 | [pluginPublicApi](../../pi-web-plugins/pluginPublicApi.test.ts)；构建后 artifact 检查 | 服务端插件需重启 |

## 标准修改流程

1. 用 rg 找行为入口和测试，确认已有改动的归属。
2. 写可验证结果，例如“重命名另一行后当前 sessionId 不变”。
3. 在最小边界补失败测试，修 owning 模块，先跑该测试。
4. 检查机器、项目、模式和进程生命周期四个横向边界。
5. 源码改动跑类型检查；跨模块生产改动跑 npm run verify。
6. 更新权威文档及相邻 HTML 中受影响声明，检查链接、示例和 git diff --check。
7. 审阅暂存区；verify:staged 是额外门槛，不代替选定的行为回归。
8. 报告要重启的进程。推送不等于部署，文档变更本身无需重启。

## 测试层选择

项目认证至少覆盖 first-use bootstrap/隔离、客户端目标传播及联邦路由契约；不能只运行 auth service 测试。重命名至少覆盖菜单资格/输入处理及非当前行的 controller 行为。附件迁移须在编辑器下一次更新前断言 controller 状态。中文文案变更同步 owning component/plugin 和相关文案断言，适用时包括 `src/client/src/coreUiChineseCopy.test.ts`。

- 数据/参数：纯函数或 service。
- 异步归属：controller，以可控制 Promise 模拟切换前后。
- 鉴权/路由/代理：route 和联邦契约。
- Lit 事件/焦点/表单：按文件启用 happy-dom；不声称验证真实布局。
- 滚动、媒体、WebSocket 代理、Bubblewrap、安装：浏览器或目标平台集成。

Windows shell、符号链接、native PTY 限制要先排查环境；不为变绿而删生产约束，不把跳过写成通过。规范见[testing-guide](../../.agents/skills/testing-guide/SKILL.md)。

## 发布与文档同步

公开声明从 src/plugin-api.ts、src/server-plugin-api.ts 构建，不手改生成文件。artifact 检查消费 dist，必须先构建。Docker 执行的 POSIX shell 资产（包括 shebang）保持 LF，同时检查实际字节和声明解释器的语法。Bash 使用 `bash -n`，不能用可能指向 Dash 的宿主 `sh` 代替；Windows checkout 必须遵守安装脚本的 `.gitattributes` 规则。

Pi SDK peer range 保持在已测试的 minor 系列。干净安装包的验证必须实际启动 Web gateway 和 session daemon，不能只运行 CLI version 或 terminal 模块；上游 SDK 入口可能导入其发布 manifest 未声明的运行时依赖。

发布给用户的功能/配置/安装/使用文档按 Changesets 添加片段；纯仓库内部材料不自动要求片段。读取 package.json 的真实包名和 files 白名单，不照抄历史示例。不要手改 CHANGELOG；发版走 GitHub Release Actions，普通提交推送不包含 npm 发布。

入口只讲阅读路线，架构页讲稳定所有权，模块页讲契约与源码导航，配置/插件参考保留精确字段。改变契约更新对应页，不到处复制。新增模块沿用“维护契约 → 行为细节 → 故障 → 源码/测试”结构，并补总目录。

验证记录写基线、实际命令和未验证边界，不能把一次静态检查当永久保证。历史设计仅供追溯，当前代码、回归测试及同步的参考优先。
