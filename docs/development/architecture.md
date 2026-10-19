# 架构与状态归属

[返回目录](../maintenance.md) · 下一层：[改动地图](change-guide.md)

## 三个组合根

| 组合根 | 负责组装 | 不应承担 |
| --- | --- | --- |
| [PiWebApp.ts](../../src/client/src/components/PiWebApp.ts) | Lit 页面、controller、插件上下文和应用壳 | 新领域逻辑、直接网络传输 |
| [app.ts](../../src/server/app.ts) / [index.ts](../../src/server/index.ts) | Fastify、普通登录、管理入口校验、本机/远端代理、文件 API | 长期 Pi 会话和终端生命周期 |
| [sessiond.ts](../../src/server/sessiond.ts) | 会话、项目认证、服务端插件、终端、活动、审计、资源回收 | 浏览器视图状态 |

Web 并非完全无副作用：它处理配置、机器登记、部分文件/包请求。关键约束是**长期运行对象由 daemon 持有**，不是“所有服务端业务都必须搬到 daemon”。

## 一次会话请求的阅读路线

```text
Lit 组件事件
  -> SessionController（选择与异步协调）
  -> api/clients.ts（请求）+ parsers.ts（响应校验）
  -> app.ts（登录/管理上下文、机器路由）
     本机 -> sessionProxyRoutes -> SessionDaemonClient
     远端 -> MachineClient -> 远端网关 -> 远端 daemon
  -> sessionRoutes -> PiSessionService -> Pi SDK
  -> SessionEventHub -> WebSocket -> controller -> Lit 更新
```

这是所有权与主要边界，不表示每个请求都经过同一函数；文件读取、插件后端和管理终端有各自路由。具体契约从模块页进入对应文件。

## 状态所有权表

| 状态 | 所有者与持久性 | 修改时的关键问题 |
| --- | --- | --- |
| 选择、草稿、面板 | 浏览器 controller/存储 | 请求完成时目标是否相同？临时 ID 是否已迁移？ |
| 项目/机器登记 | PI WEB 托管存储；项目变更有 daemon 协调 | 关闭不是删目录；cwd 是否多重归属？ |
| 运行会话、问题等待、终端 | daemon 内存及对应持久会话记录 | Web 重启不可停止；daemon 退出须释放资源 |
| 当前历史树分支 | SDK runtime，可含仅内存导航 | 异步磁盘刷新是否覆盖刚选的 leaf？ |
| 普通模型 registry | ProjectAuthService，按项目路径存储 | 不可回退全局文件或刷新其他项目 |
| 管理模型与 Workbench 授权 | 独立管理存储/daemon 服务端状态 | 完整特权不能把管理身份变普通身份 |
| 插件期望状态 | 机器配置 | 不等于正在执行的插件快照 |
| 插件实际状态 | daemon 启动后的 runtime | 需重启；浏览器入口不能匹配错误后端 |
| 当前服务通知 | 普通 daemon | 管理请求拒绝；旧实例 dismiss 不能误伤新通知 |
| 工具审计 | 普通 SQLite / 管理 ES | 正文规则分离，失败不能伪装已送达 |

完整位置与配置顺序见[配置参考](../config.md)，不要根据本机默认路径推断远端或 Docker。

## 四个横向边界

### 机器身份

资源 ID 不是跨机器全局唯一键。状态、缓存、异步回调、socket、插件注册与 URL 都保留机器。检查 await 前记录目标、之后核验目标；旧请求可以完成，但不能改写新选择的视图。

### 普通与管理模式

网关验证、限制并转发管理上下文，daemon 在执行边界继续约束。不能只靠隐藏按钮；也不要为了管理沙箱把普通工具变受限。双特权管理使用普通工具，仍保留管理身份、认证与审计。

### 配置与托管数据

可编辑配置是全局/项目 config.json，认证、偏好、归档和所有权文件是托管状态。新增核心配置扩展现有结构，说明作用域及重启要求，不创建每功能一份配置文件。

### 生命周期与异步工作

浏览器 disconnect 后，旧请求完成不能重启轮询；只清 timer 不够。daemon 监听器、刷新器、插件 channel、删除任务与审计必须在 shutdown 清理。新增服务参考依赖注入和 registerCleanup，不靠 import 副作用启动后台工作。

## 源码目录导航

| 目录 | 维护职责 |
| --- | --- |
| `src/client/src/components/` | Lit 渲染、事件绑定 |
| `src/client/src/controllers/` | 领域协调、异步归属 |
| `src/client/src/appShell/` | 布局、面板、浏览器恢复 |
| `src/client/src/api/` | HTTP、URL、响应解析、WebSocket |
| `src/shared/` | 跨层类型、协议、白名单、纯数据规则 |
| `src/server/sessions/` | 运行时、历史、队列、认证、委派 |
| `src/server/workspaces/` | 提供器、文件安全、删除 |
| `src/server/machines/` | 连接与联邦代理 |
| `src/server/plugins/` | 服务端插件、能力与后端代理 |
| `src/server/workbench/` | 资源授权、MCP、知识、Skill |
| `src/sessiond/` | Web-daemon 客户端与传输基础 |
| `pi-web-plugins/` | 随包插件 |
| `pi-packages/` | Relay、Captain's Log 等资源 |

## 维护原则

领域判断放到最小可测试服务或纯函数，Fastify/Lit 边界保持薄；文件、网络、时钟和进程副作用明确注入/清理。优先修 owning 模块，不因一次修复拆全仓库。授权或归属失败明确拒绝，不能用“默认本机”“全局凭据”或空列表吞掉问题。

工程约定见[代码质量规范](../../.agents/skills/code-quality-architecture/SKILL.md)，验证层次见[开发检查](../development-checks.md)。
