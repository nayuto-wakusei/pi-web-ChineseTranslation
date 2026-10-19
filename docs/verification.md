# 维护文档验证记录

[返回目录](maintenance.md)

核验日期：2026-10-19。源码基线：`0c2ce8ed5c3886055a4dee9322b6829278ef3e3f`。本次仅修改文档与 Changeset，不修改生产逻辑。

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
