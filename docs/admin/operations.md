# 运行维护与验证

[返回文档目录](../maintenance.md) · 前置：[维护者上手](../getting-started.md)

## 维护契约

运行配置由 config 与启动组合根解析，部署身份、有效 agent profile 和 daemon 所有权影响状态/更新诊断。修改 CLI 不能只改显示文本，要核对它读取的是已安装服务配置还是当前 shell 环境，是否检查两进程的实际运行状态。

进程所有权在 sessiondStateOwnership；启动/清理在 sessionDaemonStartup、sessionDaemonShutdown 与 sessiond 的 cleanup 注册中。通知由 ServerNoticeService/Store 持有并经 eventHub 发布，浏览器只展示和按实例关闭。活动聚合与机器状态不应放在 Web 的自动重载生命周期中。

修改后台任务时测试启动、断开、shutdown、在途请求完成与重复初始化；修改通知时测试 management 403、旧实例 dismissal 和跨机器归属。发布相关变更还要经过真正构建/安装，而不是仅 CLI --version。下面给出实际运维操作与证据层次。

## 先定位哪个进程负责

| 进程/组件 | 职责 | 重启影响 |
| --- | --- | --- |
| Web/API | 浏览器入口、Fastify 网关、联邦代理、认证 | 浏览器连接需恢复，不应停止 daemon 会话 |
| Vite/前端 | 开发页面与资源 | 不拥有长期任务 |
| sessiond | Pi 会话、模型认证、终端、活动、实时事件、服务端插件 | 可能中断活跃请求和终端，必须安排重启 |
| 远端 PI WEB | 自己的项目和执行环境 | 网关重启不等于远端重启 |

本仓库的拆分开发服务使用 `pi-web-sessiond.service` 与 `pi-web-ui-dev.service`，daemon 使用 `npm run start:sessiond`，不自动重载/重启。已安装正式服务及 Docker 可能采用不同 Web 单元名和管理方式，先用 `pi-web status` 或检查部署定义，不要盲用开发服务名。

`pi-web-ui-dev.service` 运行 `npm run dev:web` 和 `npm run dev:client`，承担 Web/API、内置插件 watcher 与 Vite UI。`src/server/index.ts`/`app.ts` 组装浏览器 Fastify 网关，经 `src/sessiond/sessionDaemonClient.ts` 和代理路由访问 daemon；`src/server/sessiond.ts` 持有长期 Pi 会话、普通项目认证、终端、活动与实时事件。

默认 daemon transport 是 `$PI_WEB_DATA_DIR/sessiond.sock`，也支持配置的 sessiond HTTP transport。协议、socket/数据目录或 transport 环境变化时，两服务必须对齐并重启。修改 `sessiond.ts`、daemon 协议/传输，或 `src/server/sessions/`、`terminals/`、`activity/`、`realtime/` 中传递依赖的 daemon 代码，也必须明确告知需要手动重启 daemon。纯浏览器插件走 UI/Web 重载；服务端插件不能归入此例外。

## 日常诊断

以下为已安装 CLI 的读取型入口；`doctor` 针对受管理安装，不证明所有手工部署都正确：

```sh
pi-web status
pi-web version
pi-web doctor
pi-web logs
```

`logs` 可能持续跟随输出，用 Ctrl+C 退出。UI 的“信息”插件提供状态与可复制诊断，“更新”插件提供检查和适用的更新/重启建议；它们不替代真实部署验收。分享诊断前删去敏感路径、用户信息和服务地址。

`pi-web version` 读取本地安装及本实例 Web/daemon 的运行状态，可能请求本实例 HTTP，但不查询 npm registry；`pi-web version --check` 才增加 registry 版本检查。启动 banner 使用实际监听端口及网卡地址，只描述本机监听，不证明防火墙、代理或远端网络可达。

排查顺序：浏览器错误/网络 → Web 状态 → daemon 状态 → 目标工作区 → 模型/插件后端。未认证 `/api/pi-web/status` 的 401 应先处理认证，不直接判定服务损坏。

## 活动、未读与通知

活动用于描述正在启动、运行、工具调用或等待的状态；未读用于提醒尚未查看的会话更新；会话通知、警告用于提醒当前会话问题。它们不能互相当作可靠的历史审计数据库。

当前服务通知属于普通 daemon 状态。关闭通知只处理对应实例中的通知，不修复根因，也不删除审计日志。管理嵌入不请求普通服务通知，daemon 同时拒绝其读取/关闭请求；管理页面仍可展示自己的浏览器错误。

远端状态必须按所选机器查看，切机器后不应把旧请求结果显示到新对象。遇到间歇问题记录发生时间、机器、项目、cwd 和会话 ID，避免只截图“错误”两字。

## 配置、数据与备份

| 位置 | 内容 | 维护原则 |
| --- | --- | --- |
| `$PI_WEB_CONFIG` 或用户 config 路径 | 全局/机器配置 | Web 与 daemon 使用同一有效配置 |
| `<project>/.pi-web/config.json` | 可提交的项目核心配置 | 合并必要键，不整文件覆盖 |
| `$PI_WEB_DATA_DIR` | 注册表、项目认证/偏好、归档、审计、IPC 状态 | 托管状态，不作为手工配置 API |
| Pi agent/session 目录 | Pi 资源、共享设置、会话存储 | 与 PI WEB 数据目录分开识别 |
| 项目工作区 | 代码、上传、保存的附件及项目资源 | 按仓库和业务文件单独备份 |

只复制 `PI_WEB_DATA_DIR` 不等于完整备份。备份应覆盖有效配置、Pi 会话/agent 数据、项目工作区及需要保留的管理审计；这些目录可能含密钥和用户内容，应加密并限制访问。建议停相关服务取得一致快照，再在隔离位置演练恢复，不覆盖活跃数据。

单个数据目录仅允许一个活跃 daemon。启动第二实例必须同时分离数据目录、daemon endpoint 和 Web 端口。不要为解决启动冲突直接删除所有权文件；先查清所报进程是否仍存活。详情见[托管数据目录](../config.md#managed-data-directory)。

## 什么时候重启

| 改动 | 必要动作 |
| --- | --- |
| 前端或纯浏览器插件 | 开发自动重载/刷新；已安装静态包先更新产物 |
| Web 路由实现 | 重启或开发自动重载 Web，不需因此重启 daemon |
| 会话/终端/审计实现、daemon 工具、服务端插件 | 手动重启目标 sessiond |
| daemon 协议、socket、数据目录、跨进程配置 | 对齐两端并重启 Web 与 daemon |
| 普通 Pi 资源 | 空闲会话 `/reload`；提供器基线变化另按配置规则重启 |

重启 daemon 前检查活跃会话和终端，并从它托管的会话之外操作。原生 systemd 用户服务可在维护窗口执行：

```sh
systemctl --user restart pi-web-sessiond.service
systemctl --user status pi-web-sessiond.service
```

本仓库拆分开发模式需要插件构建就绪，手动启动使用三个终端，先启动 Web：

```sh
npm run dev:web
npm run start:sessiond
npm run dev:client
```

这是三个独立常驻进程，不是同一 shell 顺序等待执行完毕的脚本。端口以终端输出为准；标准 Vite 通常为 8505。Docker 控制方式使用 [Docker 指南](../../docker/README.md)，不要把宿主 systemd 命令套进容器。

## 插件与包的恢复

### 安装更新

`pi-web update [--yes] [--force]` 按当前中文包 `@chainingintention/pi-web-cn` 的实际安装方式、有效 Pi profile 与安装 root 确定目标，不更新 PATH 上另一份同名安装。非交互环境必须显式 `--yes`；npm 更新先确定精确版本，确认后的执行固定该版本，`--force` 仅用于已是当前版本时重新安装 npm-global 包。

本地 checkout 必须干净且可 fast-forward，不自动合并或清理用户修改；任一更新/安装/构建步骤失败，不继续重启。自动原生服务更新仅支持 Linux/macOS 的已识别服务；Windows、未知安装及不支持的嵌套执行应在原安装工具或宿主终端处理，不绕过拒绝。

从 PI WEB 托管的会话发起时，可通过独立 systemd 用户单元或 launchd 用户 agent 交接，避免更新过程被自身 daemon 重启中断。交接返回只证明已派发，不证明实机升级完成；macOS 子进程重新核对 canonical profile 与安装摘要，不传递管理秘密。应查看交接日志，再分别核对安装、Web/daemon 版本及服务状态。入口见 [piWebUpdate.ts](../../src/piWebUpdate.ts)；安装操作见[安装页](../install.html#update)。

### 插件恢复

Pi 包负责安装资源，PI WEB 插件负责启用集成；“包已安装”不保证插件已激活。多数插件默认启用，服务端状态变更要重启，重启前期望状态与实际状态可能不同。

插件导致 daemon 无法启动时，可先读取安全启动状态，再按[插件恢复参考](../config.md#plugin-config)禁用问题插件或设置安全启动。以下第二条会修改配置，使用前替换为已确认的问题插件 ID：

```sh
pi-web plugins safe-start show
pi-web plugins disable <plugin-id>
```

不要把 `safe-start none` 当长期常规运行模式，它会跳过普通运行所需能力。恢复、重启并确认正常后清理临时安全启动设置。Relay 和可选 Captain's Log 的安装/移除区别见[插件指南](../plugins.md#included-tools-and-optional-packages)。

## 如何验证改动

从仓库根目录执行窄范围测试，先证明目标行为；源码/导出类型变化还要类型检查：

```sh
npm test -- src/server/sessions/sessionCommandService.test.ts
npm run typecheck
```

跨模块生产代码改动及最终合并审查运行 `npm run verify`。涉及发布内容时先 `npm run build` 再 `npm run check:artifacts`；`npm run pack:dry` 验证包清单并触发 prepack 构建。真实安装烟测和 Linux 平台限制见[开发检查](../development-checks.md)。

| 证据层 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| 源码/文档核对 | 当前逻辑、字段和引用一致 | 部署机器正在运行该版本 |
| 定向测试 | 对应测试边界通过 | 所有平台及外部服务可用 |
| 构建/包清单 | 可编译且预期文件纳入发布 | 干净安装和 native PTY 正常 |
| 部署烟测 | 指定机器服务与关键请求正常 | 所有业务路径无缺陷 |

部署后分别验证 Web/daemon 版本、服务活跃、带认证 HTTP、WebSocket、测试会话、终端和必要插件。涉及管理模式时追加[集成验收](management-audit.md)。禁止把失败、跳过或尚未执行的项目标为通过。

## 实现与回归入口

- 网关与 daemon：[app.ts](../../src/server/app.ts)、[sessiond.ts](../../src/server/sessiond.ts)。
- 进程所有权：[sessiondStateOwnership.ts](../../src/server/sessiond/sessiondStateOwnership.ts)。
- 通知：[serverNoticeRoutes.ts](../../src/server/notices/serverNoticeRoutes.ts)、[通知测试](../../src/server/notices/serverNoticeRoutes.test.ts)。
- 活动：[workspaceActivityService.ts](../../src/server/activity/workspaceActivityService.ts)。
- CLI：[cli.ts](../../src/cli.ts)、[pluginRecoveryCli.ts](../../src/pluginRecoveryCli.ts)。
