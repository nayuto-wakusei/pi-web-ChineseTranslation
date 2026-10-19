# 维护者上手

[返回文档目录](maintenance.md)

目标是在修改前建立最短证据链：复现现象 → 找到拥有行为的模块 → 运行定向测试 → 确认影响。无需先读完配置与插件 API。

## 确认工作基线

在仓库根目录检查分支及已有改动，保留用户工作：

```sh
git status --short --branch
git remote -v
node --version
npm --version
```

要求以 [package.json](../package.json) 的 engines、SDK peer 范围及脚本为准。当前 Node.js >=22.19.0，不能用“最新 SDK”代替已测试版本。使用 npm install 安装依赖；安装会运行依赖和 Git hook 准备，不在不可信 checkout 执行。

## 定位行为所有者

先读[架构](development/architecture.md)，再搜索入口及相邻测试：

```sh
rg --files src pi-web-plugins
rg -n 'renameSession|session.name' src
```

第二条是会话命名的例子。沿组件事件、controller、API/parser、网关、daemon service、事件回推追踪。不要看到 UI 问题就把领域逻辑加进 PiWebApp，也不要认为所有 HTTP 路由的状态都属于 Web。

| 问题 | 模块 |
| --- | --- |
| 项目、工作树、信任、删除 | [项目与工作区](modules/projects-workspaces.md) |
| 模型、OAuth、认证串项目 | [认证与模型](modules/auth-models.md) |
| 队列、历史树、命名、归档、协作 | [会话与协作](modules/sessions.md) |
| 预览、上传、终端、任务 | [文件与终端](modules/files-terminals.md) |
| 远端或子路径才发生的问题 | [联邦与接口](modules/machines-api.md) |
| 插件生命周期与公开 API | [插件维护](modules/plugins.md) |
| 管理隔离、Workbench、审计 | [管理模式](admin/management-audit.md) |

## 先运行最小回归

例如验证命名和命令：

```sh
npm test -- src/client/src/controllers/sessionController.rename.test.ts src/server/sessions/sessionCommandService.test.ts
```

遵循[测试规范](../.agents/skills/testing-guide/SKILL.md)，使断言表达可观察结果。源码/导出类型变化追加 npm run typecheck，跨模块生产改动追加 npm run verify。全量通过不能替代故障路径的针对性测试。

## 需要页面时启动拆分开发

三个独立终端，先启动 Web 生成插件构建：

```sh
npm run dev:web
npm run start:sessiond
npm run dev:client
```

使用输出中的 URL。这些命令是常驻进程，不能在一个 shell 顺序等它们结束。Windows 的 npm run dev 依赖 Bash；PowerShell 不支持 Bash here-doc。

使用测试项目/凭据，发送不修改文件的任务核对 cwd；真实模型请求可能收费。不要与已有 daemon 共用数据目录/endpoint，见[运行维护](admin/operations.md)。

## 交付前检查

用[改动地图](development/change-guide.md)确认机器、项目、管理模式和生命周期边界，以及测试、文档和重启范围。只提交本次文件；推送代码、npm 发版、远端部署是不同动作。报告实际通过、失败及未执行项，不把静态检查写成部署证明。
