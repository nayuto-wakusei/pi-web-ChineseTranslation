# 文档导航

本导航的相对链接供仓库检出阅读；npm 包不包含模块架构页，请阅读[仓库主分支文档导航](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/README.md)，随包权威参考为 [config.md](config.md) 和 [plugins.md](plugins.md)。

这里是 PI WEB 中文分支的文档入口。系统按 `Machine -> Project -> Workspace -> Session` 组织资源，由浏览器、Web/API 网关与会话守护进程协作；各篇说明对应模块的架构、边界与公开契约。

## 按目的阅读

| 目的 | 入口 |
| --- | --- |
| 了解产品、安装和使用 | [网站首页](index.html)、[安装](install.html)、[常见问题](faq.html)、[社区插件](community-plugins.html) |
| 开始维护代码 | [维护约定](maintenance.md)、[维护者上手](getting-started.md) |
| 理解整体结构与状态归属 | [架构](development/architecture.md) |
| 查找共享控件和插件样式入口 | [共享 UI 导航](ui-primitives.md)、[插件样式契约](plugins.md#styles-highlighting-and-display) |
| 查找模块职责与边界 | [项目与工作区](modules/projects-workspaces.md)、[会话](modules/sessions.md)、[认证与模型](modules/auth-models.md)、[文件与终端](modules/files-terminals.md) |
| 理解跨机器、插件与配置边界 | [机器/API](modules/machines-api.md)、[插件](modules/plugins.md)、[配置维护](modules/configuration.md) |
| 管理集成与运行维护 | [管理与审计](admin/management-audit.md)、[运维](admin/operations.md) |
| 查公开使用契约 | [配置参考](config.md)、[插件指南](plugins.md)、[机器联邦](machines.html)、[远端使用](remote-first.html) |
| 选择验证与交付检查 | [改动联动](development/change-guide.md)、[开发检查](development-checks.md) |

## 目录职责

| 位置 | 内容与边界 |
| --- | --- |
| `docs/` | 用户指南、配置与插件参考、网站页面、社区插件 npm 发现目录及维护入口。成对的 Markdown/HTML 页面保持契约一致。 |
| [`development/`](development/) | 全局架构、状态所有权和跨模块改动约束。 |
| [`modules/`](modules/) | 各领域的职责、协作关系、不变量及少量源码导航。 |
| [`admin/`](admin/) | 管理权限、审计边界、部署和服务生命周期。 |
| [`assets/`](assets/) | 网站引用的静态资源，不承载架构或配置权威说明。 |
| [`superpowers/specs/`](superpowers/specs/) | 历史设计材料，仅供追溯，不代表当前架构。 |
| [`superpowers/plans/`](superpowers/plans/) | 历史实施计划，不作为当前使用与维护契约。 |
