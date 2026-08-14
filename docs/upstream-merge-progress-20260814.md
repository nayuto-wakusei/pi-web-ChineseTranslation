# 上游主分支手工融合进度（2026-08-14）

## 当前状态

- 集成分支：`codex/merge-upstream-20260814`
- 基线分支：本地 `main`
- 当前进度：计划中的第 1、2、3 项已完成，最终审查修复、组合验证和远端测试部署均已完成
- 合并策略：未使用自动合并；按功能包阅读上游差异后手工移植
- 取舍原则：优先保留本地中文实现、项目级认证隔离、管理模式安全边界和既有兼容路径
- 远端状态：已部署到 `192.168.2.162` 测试；未 push

## 与原始上游功能包编号的对应关系

本轮已经完成原始 10 项上游功能包中的 **1、2、3**：

1. **工作区 Provider 与 Plugin API v2**：已完成。
2. **联邦机器状态树**：已完成。
3. **Pi 0.84 运行时与配置体系**：已完成。

以下功能包尚未融合，不属于当前 5 个集成提交：

4. **会话列表性能与工作区边界**：未开始；仍需决定保留本地跨工作区父子关系，还是接受上游“仅当前工作区”的规则。
5. **子会话与委派能力**：未开始。
6. **会话树与聊天体验**：未开始。
7. **安全文件预览**：未开始。
8. **统一模态框与远端 OAuth**：未开始。
9. **运维、CLI 与 Docker**：未开始。
10. **Relay、导航与文档站**：未开始。

因此，本文后续“第 1、2、3 项已完成”均指上述原始功能包编号，不表示 10 项上游增量已经全部融合。

## 已完成内容

### 1. Workspace Provider / Plugin API v2

- 增加 Provider Plugin API v2 基础能力和服务端插件运行时。
- 增加工作区 Provider 目录、删除流程、联邦代理及恢复命令。
- 融合 Git Provider 插件基础实现。
- 暂时保留原有 Git 核心路由作为兼容路径，待新插件路径稳定后再评估移除。
- 补充中文 Changeset：`.changeset/provider-plugin-v2-cn.md`。

对应提交：`d7d8fd7c feat: add provider plugin api v2 groundwork`

### 2. 联邦机器状态树

- 增加按 `SessionEventScope` 隔离的机器状态快照。
- 接入 session daemon 状态服务、HTTP 路由和实时事件。
- 增加客户端状态树展示和相关解析、契约测试。
- 保持本地与远端机器身份在状态和事件链路中的作用域隔离。
- 补充中文 Changeset：`.changeset/machine-status-tree-cn.md`。

对应提交：`36cefc68 feat(status): add scoped machine status tree`

### 3. Pi 0.84 运行时与配置

- Pi 相关依赖升级到 0.84 系列。
- 融合新的状态所有权、环境变量清理和会话事实模型。
- 保留普通模式的项目级认证、模型和偏好存储隔离。
- 保留管理模式独立的认证、Workbench、沙箱和审计边界。
- 限制请求链路中的隐式模型目录联网刷新；显式后台刷新仍可按既有策略联网。
- 补充中文 Changeset：`.changeset/pi-084-runtime-cn.md`。

对应提交：`5251311e feat(runtime): adopt Pi 0.84 state model`

## 合并后补充修正

- 管理模式上下文现在会完整传递到 session daemon 的插件后端、工作区目录和删除路由。
- 已授权的管理项目使用管理上下文解析，未授权请求返回 `403`，不会回退到普通 `ProjectStore`。
- Pi 0.84 的 `allowModelNetwork` 仅约束创建阶段；本地在运行时创建边界补充了默认联网限制，覆盖普通模式、管理模式和默认会话运行时。
- 放宽高负载并行验证下 Git 子模块测试和交互认证测试的等待时间，不改变产品行为。

## 最终审查修复

- 插件后端请求统一经过管理模式 API 作用域处理，浏览器会携带管理嵌入参数，不会回退到普通项目存储。
- 工作区删除在网关和 sessiond 两层校验签名工具 allowlist，并将管理上下文传入删除命令运行时。
- 删除命令的并发 flight 按管理事件作用域、项目路径和工作区隔离，避免跨管理会话复用。
- 浏览器断开时，工作区删除的取消信号会继续传递到 session daemon 的 HTTP 或 socket 请求。
- 机器状态归属缓存改为按事件作用域隔离；管理项目使用管理上下文恢复项目和工作区拓扑。
- 插件后端及工作区删除完成后，会刷新对应普通或管理作用域的状态树。
- Plugin API 文档已迁移到浏览器 API v2，并明确移除 `plugin-api/unstable`；破坏性 Changeset 调整为 `major`。
- 内置 Git 插件的操作、状态、错误和删除确认文案已完成中文化，并加入中文文案回归断言。

对应提交：

- `9c96a8c1 fix(workspaces): preserve management authority through sessiond`
- `82e1bef4 fix(runtime): keep Pi auth refreshes local`
- `0a93455d fix: close upstream integration review gaps`

## 验证结果

已通过以下检查：

```text
npm run verify
  Test Files  323 passed | 3 skipped
  Tests       2715 passed | 34 skipped

npm run build:plugin-api
npm run pack:dry
git diff --check main...HEAD
```

`npm run verify` 包含：

- TypeScript 类型检查
- ESLint
- Knip 未使用代码检查
- Vitest 全量测试

打包预演生成的包信息：

- 包名：`@chainingintention/pi-web-cn`
- 版本：`1.202608.9`
- 文件数：407
- 压缩后约 2.0 MB，解包后约 5.8 MB

## 远端测试部署

- 目标：`192.168.2.162`，`admin123` 用户级 systemd 服务。
- 部署来源：集成分支提交 `0a93455d`，未合并到 `main`，未 push。
- 安装方式：从本地提交构建 `@chainingintention/pi-web-cn@1.202608.9` tarball，上传后全局安装。
- 包 SHA-256：`121c4e73d1e9a62e8620c262b2c18c86968c970011d30e28da85f4787751c4d7`，本地与远端一致。
- 远端原版本：`1.202608.8`；部署后版本：`1.202608.9`。
- Pi 运行时依赖：`@earendil-works/pi-coding-agent@0.84.1`；远端 Node：`v24.16.0`。
- 已在部署目录保留旧安装副本：`/home/admin123/deploy/pi-web-upstream-123-0a93455d-20260814/previous-package`。
- 已确认 `node-pty` 原生模块可加载。
- 已按顺序重启 `pi-web-sessiond.service`、`pi-web.service`；两项均为 `active/running`，重启计数为 0。
- sessiond `/health` 返回 `200`；首页和 PWA manifest 返回 `200`。
- 普通模式启用了登录保护，未携带登录态访问 `/api/pi-web/status` 返回预期的 `401`，因此未将该响应记作失败。
- `pi-web doctor` 确认 session daemon 运行版本为 `1.202608.9`、`node-pty` 正常；Web 版本探针同样因登录保护显示不可用。
- 本地与远端 7 个关键构建文件的 SHA-256 全部一致，覆盖 sessiond、管理作用域、删除链路、daemon 客户端和内置 Git 插件。
- 重启后的 warning 以上级别日志为空；Git 服务端插件已成功激活。

### `ask_user` 工具热修复

- 现场现象：远端全局配置为 `askUser: true`，但会话运行时没有注册 `ask_user`。
- 根因：session daemon 创建 `PiSessionService` 时漏传 `askUserEnabled: config.askUser`；工具定义、管理权限 allowlist 和客户端问答卡片链路本身正常。
- 修复提交：`eef9dd9d fix(sessiond): restore ask user tool registration`。
- 针对性验证：3 个测试文件、29 个测试通过；TypeScript 类型检查和相关 ESLint 检查通过。
- 修复包 SHA-256：`2c6550e106e11b7b4af2cfa00d0bf492982373f96f3b9fd9174a77a3ea2d3dbf`，本地与远端一致。
- 远端旧安装副本：`/home/admin123/deploy/pi-web-ask-user-eef9dd9d-20260814/previous-package`。
- 已重新安装并仅重启 `pi-web-sessiond.service`；daemon PID 已更新，`/health` 返回 `200`，`stale: false`，warning 以上级别日志为空。
- 远端运行态检查确认：有效配置为 `askUser: true`，daemon 构建包含配置传递，运行时自定义工具集合包含 `ask_user`。

## 当前提交序列

截至 `ask_user` 热修复部署，下面列出的代码和既有部署记录基线共有 8 个提交；本段部署进度的文档回写提交另计：

```text
eef9dd9d fix(sessiond): restore ask user tool registration
2a404929 docs: record upstream integration deployment
0a93455d fix: close upstream integration review gaps
82e1bef4 fix(runtime): keep Pi auth refreshes local
9c96a8c1 fix(workspaces): preserve management authority through sessiond
5251311e feat(runtime): adopt Pi 0.84 state model
36cefc68 feat(status): add scoped machine status tree
d7d8fd7c feat: add provider plugin api v2 groundwork
```

## 保留事项

- 尚未将集成分支合回本地 `main` 或 `dev`。
- 尚未 push 任何提交或分支。
- 原工作区已有的未跟踪内容未纳入本次合并和提交：
  - `.changeset/steady-streamed-message-width.md`
  - `artifacts/`
  - `output/`
  - `pi-web-workbench-mcp-integration-v1.md`

## 后续步骤

1. 使用已有普通模式登录态做浏览器人工冒烟，重点覆盖 Git 面板、机器状态树和工作区删除权限边界。
2. 单独决定是否将 `codex/merge-upstream-20260814` 合入目标本地分支。
3. 单独决定是否 push；当前没有执行 push。
