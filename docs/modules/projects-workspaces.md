# 项目与工作区

[返回文档目录](../maintenance.md) · 前置：[维护者上手](../getting-started.md)

## 维护契约

**职责**：把注册项目转换成权威工作区目录，协调项目变更、信任和提供器删除，不负责会话模型选择或直接实现所有 Git 行为。

调用路线：Project/Workspace controller → API → app 的项目路由/daemon 工作区目录 → ProjectService、WorkspaceProviderRegistry；删除则由 WorkspaceRemovalService 调用提供器 prepare 和终端命令能力。Git 发现/删除计划在 Git 服务端插件中，不应硬编码进通用目录服务。

| 状态/依赖 | 归属与不变量 |
| --- | --- |
| 项目注册 | ProjectStore；关闭只移除注册，不能递归删除目录 |
| 提供器目录 | daemon 的 WorkspaceProviderRegistry；degraded 不是权威空列表 |
| 未读清理 | ProjectLifecycleService 串行协调；发现失败不能当空目录误清理 |
| 删除确认 | 服务端重新解析权威目标；旧 precondition 不可强行放行 |
| 删除副作用 | 钩子探测先于关闭终端，命令在另一个合法执行工作区运行 |

改动时先区分注册、发现、磁盘删除三个边界。提供器契约变化要检查公开 server-plugin-api、工作区响应解析和联邦路由；删除测试注入 provider/terminal/hook，分别断言过期确认拒绝、失败前不关闭终端、命令只启动一次。daemon 实现变化需手动重启。代码入口在本篇末尾，跨模块测试见[改动地图](../development/change-guide.md)。

提供器 degraded、诊断或发现异常会延期未读清理，不阻挡无关健康项目的添加；项目 catalog 读取或未读持久协调失败仍阻挡添加，不把持久失败降级为成功。归属见 [projectLifecycleService.ts](../../src/server/projects/projectLifecycleService.ts)。

## 用途与边界

项目把服务器上的目录登记到 PI WEB；工作区决定代理、文件面板和终端实际使用的 `cwd`。浏览器选择的本机目录不能代替远端服务器路径。添加项目不是自动克隆 Git 仓库，关闭项目也不是删除磁盘目录。

工作区列表由服务端提供器解析。内置 Git 插件发现 Git 工作树；没有提供器认领时使用项目目录。不要假定一个工作区就是一个分支，也不要假定所有工作区都支持 Git 操作。

## 添加、选择与关闭

1. 先选机器，再打开添加项目对话框。
2. 输入该机器上的项目路径。目录不存在时，按界面选择是否创建；已有仓库应选择真实工作目录。
3. 检查项目中的扩展、包与配置来源，只对可信内容勾选“信任此项目”。
4. 添加后选择工作区，核对显示路径，再创建会话或终端。
5. 不再需要展示项目时关闭项目。此操作移除注册，不清除仓库；也不要把它当作“停止全部会话”的按钮。

重新添加仍存在的目录前，先确认是否已有另一个注册项目认领了同一工作区。普通会话启动、列表和认证需要 `cwd` 唯一归属于注册项目；零匹配或多匹配会报错，不从全局凭据猜测归属。

目录建议或信任读取失败不等于空结果或允许决定；应在原目标机器和路径上重试，不从失败推断目录不存在或项目已受信任。

普通导航顺序是 Web 持有的每机器托管状态，项目、工作区和会话均保留完整作用域，保存使用 revision 冲突检查；离线对象不因一次列表缺失而自动遗忘。它不改变项目/工作区 authority，也不与管理导航偏好共用存储。浏览器的分区高度和展开状态另属本地视图偏好。

## 项目信任

“信任”控制 Pi 是否加载项目本地资源，不是把文件目录变成操作系统沙箱。可信项目中的扩展可以执行代码，因此审阅 `.pi/extensions/`、项目包和设置很重要。

信任保存失败时保留最后确认的服务端决定并回滚控件，显示失败原因，不把乐观勾选当作成功授权。

- 添加项目时未勾选信任，不会自动写入允许决定。
- 工作区菜单可以切换信任；决定写到执行机器，不是浏览器所在电脑。
- 新建/重新打开运行时读取新决定；已打开运行时不会立即改变，`/reload` 保留该运行时原有信任状态。
- 普通模式不靠运行中的浏览器信任弹窗兜底；资源是否加载遵循全局扩展决定、已保存决定和 Pi 默认策略。
- 管理嵌入使用独立授权，不通过普通信任 API 修改决定。

具体优先级见[项目信任配置](../config.md#project-trust-for-project-local-resources)。

## Git 状态与工作树

选择 Git 工作区后，在 Git 面板查看状态和文件差异，结合文件面板检查实际内容。Git 后端运行在工作区所属机器，网关不能代替离线的远端执行 Git。

创建额外工作树可使用该机器的 Git 命令或已安装提供器的操作，再刷新工作区列表。例如在测试仓库主目录执行：

```sh
git worktree add ../demo-feature -b demo-feature
git worktree list
```

这是会修改仓库并创建目录的示例，不是文档验证时自动执行的命令；先确认分支和目录不存在。新增工作树仍属于原项目，共享该项目的模型认证和默认偏好。

Git 插件禁用后，不保证继续发现工作树；没有其他提供器认领时退回项目目录。服务端插件启用/禁用需重启目标 daemon，参见[插件管理](../plugins.md#install-and-manage)。

Git 的命名 hook 可向对应 daemon 发送工作区变化提示。提示不直接注册工作区；宿主重新查询当前提供器。普通注册项目才维护这项集成，不修改 `core.hooksPath`，开发实例使用独立 namespace。钩子并不替代提供器的权威发现，来源入口见 [Git 插件](../../pi-web-plugins/git/)。

Workflows 的工作树操作先选择 base 与用途，再由所属机器的服务端重新验证项目、工作区和 Git base 后派发。创建工作树、发布会话与浏览器导航是不同结果；不确定的派发或导航失败不自动重复创建。安装与移除记忆见[插件指南](../plugins.md#workflows)。

## 删除工作区

删除工作区与关闭项目、归档会话是三种不同操作。删除会实际修改磁盘，必须先保存并审阅修改、停止依赖它的任务，并确认目标路径。

1. 使用工作区菜单提供的删除操作；只有提供器声明可删除的对象才有相应能力。
2. 核对确认对话框中的目标。服务端会重新解析提供器与删除前提；确认后目标改变会拒绝旧请求，应刷新后重试。
3. 宿主检查删除钩子，再关闭目标工作区终端，在命令执行工作区启动删除命令。
4. 查看终端最终退出结果和刷新后的工作区列表。拿到命令运行 ID 只说明命令已启动，不等于删除成功。

Git 使用 `git worktree remove`，不是递归强制删目录。存在可执行 `.pi-web/hooks/worktree-pre-remove` 时，以目标路径为唯一参数先执行，成功才继续删除；钩子失败保留工作区。钩子在**执行删除命令的工作区**查找，不一定在被删目录内。详细契约见[删除前钩子](../config.md#worktree-pre-remove-hook)。

## 故障定位与自检

| 现象 | 先检查 |
| --- | --- |
| 项目路径不存在 | 当前机器、绝对路径、daemon 系统账号权限 |
| 工作树消失或只剩主目录 | Git 插件实际激活状态、提供器诊断、是否需要重启 |
| 无法确定认证配置 | 工作区是否唯一归属一个注册项目 |
| 修改信任后没有生效 | 是否仍在旧运行时；不要误以为 `/reload` 会改变信任 |
| 删除请求冲突 | 刷新列表重新确认，不重复提交旧的删除前提 |
| 删除命令失败 | 终端输出、Git 脏状态、钩子退出码；不要改用强制递归删除绕过 |

建议在临时仓库自检：添加项目 → 查看工作树 → 新建会话核对 cwd → 关闭并重新添加项目，确认文件仍在。删除验收另建无重要数据的工作树，分别验证钩子成功/失败；不要拿真实工作目录做破坏性验证。

## 实现与回归入口

- 项目注册：[projectService.ts](../../src/server/projects/projectService.ts)、[projectLifecycleService.ts](../../src/server/projects/projectLifecycleService.ts)。
- 工作区权威：[workspaceProviderRegistry.ts](../../src/server/workspaces/workspaceProviderRegistry.ts)、[Git server-plugin.ts](../../pi-web-plugins/git/server-plugin.ts)。
- 删除：[workspaceRemovalService.ts](../../src/server/workspaces/workspaceRemovalService.ts)、[回归测试](../../src/server/workspaces/workspaceRemovalService.test.ts)。
- 路由验收：[app.projects.test.ts](../../src/server/app.projects.test.ts)、[projectTrustRoutes.test.ts](../../src/server/projectTrustRoutes.test.ts)。
