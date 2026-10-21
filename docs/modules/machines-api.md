# 机器联邦与接口

[返回文档目录](../maintenance.md) · 前置：[维护者上手](../getting-started.md)

## 维护契约

**职责**：保留本机能力的机器作用域，将远端请求转发到正确实例；不是无限制 HTTP 代理，也不接管远端 runtime。

连接元数据由 MachineStore/MachineService 持有；HTTP 转发使用 MachineClient/机器代理路由，socket 使用对应 bridge。客户端请求统一通过 api/，不要从组件或插件绕过 helpers 直接 fetch 私有地址。

新增端点的联动顺序：shared 请求/响应类型 → 本机路由及 local 别名 → federatedRoutes 白名单 → api clients/urls/parsers/sockets → route contract 测试。需要限额、取消或管理 context 的端点，应在每一跳保留约束，不能只限制入口。

重点回归：本机传统路径与 local 别名等价；远端请求保留机器身份；动态路径编码；子路径部署 HTTP/WS 均正确；远端错误不回退本机；切换机器后旧请求不改新状态。只测试根路径和单机不能覆盖这些契约。

## 网关与工作机器

浏览器只连接一个 PI WEB 网关，网关可以代理其他可信 PI WEB 机器。远端仍有自己的 daemon、目录、项目注册、模型认证、插件和系统账号权限；联邦不是把远端文件复制到本地运行。

```text
浏览器 -> 网关 Web/API -> 本机 daemon
                    -> 远端 Web/API -> 远端 daemon
```

本机标识为 `local`，不能像普通远端条目一样修改或删除。移除远端注册只断开网关的登记关系，不卸载远端服务或删除远端项目。

## 注册与日常使用

1. 在远端单独安装并启动 PI WEB，先确认它自身的 Web 和 daemon 状态。
2. 确保**网关服务器**能访问远端地址。浏览器能打开远端不代表网关能访问。
3. 添加机器名称、PI WEB base URL 及需要的认证令牌/代理请求头。嵌套部署 URL 应包含正确前缀。
4. 查看连接健康和运行时信息，选择该机器，再添加或选择远端项目。
5. 首次运行先用测试工作区验证文件读取、终端和模型调用，随后再开始重要任务。

本分支普通访问支持用访问密码作为 Bearer 认证的输入；远端或前置代理也可能有自己的认证要求，应确认请求实际到达哪层。连接秘密由网关保存，不应贴到日志、截图或仓库。

健康查询是有缓存的快照，不是所有功能的完整验收。HTTP 可达、daemon 可用、插件后端兼容和模型调用成功需要分别判断。

## 设置到底保存在哪台机器

| 设置/操作 | 目标 |
| --- | --- |
| 项目、会话、文件、终端、Git、活动 | 所选机器 |
| Pi 包、插件期望状态、daemon 工具 | 所选机器 |
| 上传/附件、路径访问 | 所选机器及项目 |
| 模型认证与默认值 | 所选机器上所属项目/模式 |
| 网关监听、端口、允许主机 | 当前网关 |
| 机器注册与连接秘密 | 当前网关 |
| 快捷键 | 网关/浏览器使用范围，不随远端会话迁移 |

远端不支持某项能力时应该报错，不会静默改网关设置。插件后端在远端执行，浏览器入口经网关提供；机器专属插件不能用网关同名插件冒充。版本不匹配时先对齐网关与目标运行时。

## HTTP 与 WebSocket 边界

下表是**服务端路由模式**，不是浏览器应直接拼接的根路径：

| 路由族 | 本机兼容路径 | 带机器作用域路径 |
| --- | --- | --- |
| 项目 | `/api/projects` | `/api/machines/:machineId/projects` |
| 工作区 | `/api/projects/:projectId/workspaces` | `/api/machines/:machineId/projects/:projectId/workspaces` |
| 会话 | `/api/sessions/...` | `/api/machines/:machineId/sessions/...` |
| 模型认证 | `/api/auth/...` | `/api/machines/:machineId/auth/...` |
| 活动/状态/通知 | `/api/activity`、`/api/status`、`/api/notices` | 对应带机器前缀的路径 |

仅受支持路由列入联邦白名单；并非任意 `/api/...` 都能透传。消息、终端和插件 channel 使用不同 WebSocket 路由，必须同时保持机器和认证作用域。字段及响应以 [apiTypes.ts](../../src/shared/apiTypes.ts) 和具体路由为准，本页不是无版本约束的 REST API 承诺。

Web 与 daemon 使用相同的 WebSocket 错误处理：接收器因协议错误已发起关闭握手时，保留其关闭帧（例如载荷超限的 `1009`），不以立即断开覆盖为 `1006`；其他错误仍终止连接。此处理不放宽插件 channel 的握手帧或数据帧限额。

本机能力同时保留传统 `/api/...` 与 `/api/machines/local/...` 别名；远端走 `/api/machines/:machineId/...` 代理。新增机器 HTTP/WS 端点必须同步 `src/shared/federatedRoutes.ts`、本机路由注册、客户端和联邦路由契约测试。

浏览器传输统一在 `src/client/src/api/`：`clients.ts` 管理端点族，`urls.ts` 构造地址，`http.ts` 管理 HTTP/认证作用域，`sockets.ts` 管理 socket。共享请求/响应类型放在 `src/shared/apiTypes.ts`；响应视为不可信输入，在 `parsers.ts` 或其子模块校验，不能在组件或 controller 中强制类型转换。浏览器 URL 约束：

- PI WEB 自有路径使用无前导 `/` 的应用相对引用，例如 `api/...`、`pi-web-plugins/...`。
- 动态路径段逐段 `encodeURIComponent`；查询值也要编码，多字段查询用 `URLSearchParams`。
- 每个引用只在浏览器边界解析一次：普通 JSON 请求交给 `request()`；直接 DOM/浏览器 API 接收基于 `resolveAppUrl()` 的 helper 生成的 URL；WebSocket 使用 `resolveAppWebSocketUrl()`。
- 返回未解析引用的 helper 用 `Path` 后缀，返回浏览器可用绝对地址的 helper 用 `Url` 后缀。
- 插件模块必须使用 `resolvePluginModuleUrl()`；它对前导 `/` 的兼容是滚动升级专用例外，不能推广到其他应用路径。
- JavaScript 加载前的 HTML 资产使用 Vite `%BASE_URL%`，PWA manifest 引用保持 `./` 相对路径。外链、data URL、模块相对插件资产不属于应用路径。

审查生产客户端时，用 rg 查找原始 `fetch`、`WebSocket`、`XMLHttpRequest`、携带 URL 的 DOM 属性，以及前导 `/api`、`/pi-web-plugins` 字面量；每个应用自有结果必须符合上述边界，不能仅修被报告的一条地址。

新增机器能力时，应同时核对联邦路由、本机注册、客户端调用与路由契约测试，否则本机成功可能掩盖远端缺失。

## 反向代理与故障排查

嵌套路径部署需要规范尾斜线：例如先把 `/pi-web` 重定向到 `/pi-web/`，再按同一前缀转发 HTTP 和 WebSocket。不要只修首页，遗漏终端 socket、插件资源和鉴权。部署配置参考[反向代理前缀](../config.md#reverse-proxy-deployment-paths)。

| 现象 | 排查顺序 |
| --- | --- |
| 离线/超时 | 网关到远端网络、地址、代理、远端 Web |
| 401/403 | 普通密码/Bearer、代理认证、模式权限；不是模型 key 问题 |
| 项目有但终端无输出 | 远端 daemon、终端插件、WebSocket 代理 |
| 切机器后出现旧内容 | 记录机器及资源 ID，检查客户端异步目标/缓存归属 |
| 远端 Git/插件不可用 | 两端版本、后端实际激活状态、重启是否完成 |
| 子路径首页可用但资源失败 | 尾斜线、路径剥离、根路径硬编码 |

验收时用两台测试机器分别建立同名项目，切换并核对 cwd、文件及设置归属；测试 HTTP 与 WebSocket 两条链路。单机 mock 测试不能证明真实网关、防火墙和反向代理已配置正确。

## 实现与回归入口

- 注册和健康：[machineService.ts](../../src/server/machines/machineService.ts)、[machineRoutes.ts](../../src/server/machines/machineRoutes.ts)。
- 转发：[machineClient.ts](../../src/server/machines/machineClient.ts)、[machineProxyRoutes.ts](../../src/server/machines/machineProxyRoutes.ts)。
- 白名单：[federatedRoutes.ts](../../src/shared/federatedRoutes.ts)。
- 浏览器：[clients.ts](../../src/client/src/api/clients.ts)、[urls.ts](../../src/client/src/api/urls.ts)、[parsers.ts](../../src/client/src/api/parsers.ts)。
- 测试：[app.localAliases.test.ts](../../src/server/app.localAliases.test.ts)、[app.remoteProxy.test.ts](../../src/server/app.remoteProxy.test.ts)、[appUrl.test.ts](../../src/client/src/appUrl.test.ts)。
