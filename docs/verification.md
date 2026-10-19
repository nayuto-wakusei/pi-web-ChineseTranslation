# 维护文档验证记录

[返回目录](maintenance.md)

初次维护文档核验日期：2026-10-19。源码基线：`0c2ce8ed5c3886055a4dee9322b6829278ef3e3f`。该次仅修改文档与 Changeset，不修改生产逻辑。以下记录保留原验证范围；后续 AGENTS 精简的证据单列在末尾，不将历史测试算作重新执行。

## 验证范围

通过当前源码核对进程所有权、项目认证、命令实际分派、文件限额、工作区删除、联邦路由、管理权限、Workbench bootstrap 和插件公开入口。文档中的实际源码/测试链接用于复查；历史设计不作为当前行为的替代证据。

## 本地检查

| 检查 | 实际结果 |
| --- | --- |
| Markdown 本地链接、锚点、源码/测试路径 | 14 篇维护文档，210 个本地链接，无缺失 |
| 示例解析 | JSON 示例经 JSON.parse 与真实任务配置解析器校验；7 处围栏内 npm run 引用均存在 |
| 第一组模块回归 | 15 文件、176 测试通过 |
| 配置模块回归 | 5 文件、119 测试通过、1 跳过 |
| `node --import tsx src/cli.ts --help` | 成功；核对文档中 CLI 命令入口，未执行服务修改 |
| `npm run verify:staged` | 类型检查、Knip、文档关联测试 3 项通过；无需 ESLint 的源码改动 |
| `npm run pack:dry` | prepack 完整构建及包清单检查成功 |
| `npm run check:artifacts` | 3 文件、9 测试通过 |
| `npm pack --dry-run --ignore-scripts --json` | 最终文档路径调整后复核：540 项；维护章节未意外纳入包 |
| `git diff --check` | 无空白错误；提交前另检查暂存区 |

配置测试跳过项是 `src/config.test.ts` 中非 Windows 平台的 foreign-platform absolute path 拒绝用例，测试通过 `skipIf(process.platform === "win32")` 明确跳过。本次未在非 Windows 平台补跑，不能计为通过。

构建有两类提示：Vite 将来 native config loader 对无扩展名 import 的兼容警告，以及大于 500 kB 的 chunk 提示。退出码为 0；本次未修改配置/拆包来消除这些非文档问题。

### 可复跑的定向命令

从仓库根目录运行，单 worker 降低 Windows 测试环境竞争：

```sh
npm test -- src/server/sessions/sessionCommandService.test.ts src/client/src/controllers/sessionController.rename.test.ts src/server/sessions/sessionCleanup.test.ts src/server/sessions/projectAuthService.test.ts src/client/src/controllers/authController.test.ts src/client/src/api/federatedRouteContract.test.ts src/client/src/appUrl.test.ts src/server/managementPrivileges.test.ts src/server/workbench/gatewayIntegration.test.ts src/server/notices/serverNoticeRoutes.test.ts pi-web-plugins/workspace-tasks/config.test.ts src/shared/workspaceFiles.test.ts src/server/workspaces/workspaceRemovalService.test.ts pi-web-plugins/pluginPublicApi.test.ts src/docker/piWebDockerDocs.test.ts --maxWorkers 1
npm test -- src/config.test.ts src/server/configRoutes.test.ts src/server/workspaces/projectPiWebConfig.test.ts src/client/src/components/settings/settingsConfigDraft.test.ts src/client/src/components/settings/settingsMachineTarget.test.ts --maxWorkers 1
```

链接核验用仓库已有 `marked` 解析 Markdown link/image token，再检查本地目标、标题/显式 id 锚点；JSON 示例调用 `parseTasksConfig`，npm 脚本与 package.json 比对。核验覆盖 maintenance/getting-started/verification 及 development/modules/admin 下的新文档，不声称已重查全部历史 HTML 或外部网站。

### 核验中修正的问题

- 维护入口最初名为 `docs/README.md`，npm 自动带入该文件却不包含关联章节。已改名 `docs/maintenance.md`，根 README 使用 GitHub 地址，最终包清单确认没有孤立维护导航。
- 补全命令目录不代表命令实际可执行；会话文档按 SessionCommandService 分派逻辑区分已实现命令，未把 `/share`、`/export`、`/import` 宣称为 Web 已实现。
- 文档结构以代码维护为中心，明确区分注册项目、工作区磁盘删除、归档，以及普通/管理身份，不以操作入口替代状态归属说明。

## 未执行项

本次仅文档改动，未运行全量 `npm run verify`、全量 ESLint 或真实全局安装烟测；使用定向回归、暂存区门槛、构建和 artifact 验证。没有启动开发服务器进行浏览器布局验收。

本次不进行真实模型/OAuth、Linux Bubblewrap、真实 Workbench/MCP/Elasticsearch、双机联邦、反向代理或生产部署验收；不修改服务、不重启 daemon、不发布 npm。各模块部署自检步骤是维护者验收指引，不是本次已完成的生产测试。

## AGENTS 规则迁移核验

日期：2026-10-19；旧规则基线：`24938a98` 的根 `AGENTS.md`。根文件从 123 行缩为 54 行，只保留全局约束和强制阅读导航；功能规则迁入既有模块页，不另建平行规则手册。功能改动同步文档、删除旧表述的要求仍保留。

以下按旧文件行号逐段人工核对语义（包括每段内的例外与禁止项），并用行号集合检查完整性：72 个非空、非标题段落全部有去向，无未映射项。集合检查不代替语义审阅，也不证明实现的运行效果。

| 旧行号 | 规则去向与核对重点 |
| --- | --- |
| 3、5 | 根 AGENTS：中文 fork、协议标识不翻译、提交作者 |
| 9、11–14、16 | [架构](development/architecture.md)：四层模型定义与机器身份 |
| 20、22、23、25、29、33、35、44 | [运维](admin/operations.md)：进程所有权、开发服务、IPC、重启和通知隔离 |
| 27、45–47、71、95、96 | [认证模型](modules/auth-models.md)：两类 store、唯一项目解析、精确 registry、固定 OAuth 目标、偏好路径与首次复制 |
| 31、72、74 | [会话](modules/sessions.md)：内存 leaf/reset-to-root、异步磁盘竞态、命名资格/事件、滚动布局 |
| 39–42、82–89 | [机器接口](modules/machines-api.md)：别名、联邦联动、解析边界、URL helpers/例外/审查和尾斜线 |
| 43、51–61 | [管理审计](admin/management-audit.md)：三种权限、Relay 同步与 collision、委派、AGENTS 过滤、Workbench、审计正文及身份 |
| 65、66、103 | [架构](development/architecture.md)及根 skill 导航：组合根、异步 timer 生命周期、工程约束 |
| 67–69 | [插件](modules/plugins.md)：可信代码、资产目录、公开 API、生成声明与远端 helper |
| 70、109、111、123 | [改动地图](development/change-guide.md)：文案/认证/命名/布局回归、shell 字节与解释器、SDK minor 和干净安装 |
| 73 | [附件](modules/files-terminals.md)：增删/reset 同步、临时 key、下一次 editor 更新前的断言 |
| 78、105、107、115、119、121 | 根 AGENTS：真实验证报告、测试层次、文档同步、Changesets 和 Actions 发布 |
| 93、94、97–99 | [配置](modules/configuration.md)：配置与托管状态、默认路径、单一项目配置和联邦设置目标 |

唯一有意澄清的旧措辞是 `plugin-only changes`：仅纯浏览器插件走 UI/Web 重载；服务端插件必须重启 daemon。没有照搬上游 whitespace-only pre-commit，本地仍运行 `npm run verify:staged`。

本次重新执行 Markdown 本地链接/锚点检查（根 AGENTS 加 14 篇维护文档，共 240 个本地链接，无缺失），1 个 JSON 任务示例通过真实解析器，7 处围栏内 npm scripts 引用有效。`npm test -- src/docker/piWebDockerDocs.test.ts` 为 1 文件、3 测试通过；`npm run verify:staged` 的增量全项目类型检查、Knip 和关联文档测试 3 项通过，无需 ESLint 的源码改动；`git diff --cached --check` 通过。根文件和维护页无对应 HTML 副本，未改包内配置/插件权威参考，因此无需 HTML 同步或 Changeset。

此次只迁移文档，不改生产代码、依赖或打包清单；没有重跑全量 verify、构建、artifact、干净安装或外部服务验收，也没有部署或重启服务。上述旧记录的 295 项通过及 1 项跳过不属于本次重跑结果。
