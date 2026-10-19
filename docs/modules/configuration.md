# 配置与设置维护

[返回目录](../maintenance.md) · 字段/默认值权威参考：[config.md](../config.md)

## 职责与调用链

配置模块将磁盘文件、环境覆盖和项目设置解析为有效运行值，并提供给 UI、网关与 daemon。托管 auth/models/preferences 数据不是普通配置的另一份副本。

```text
全局文件 -> shared/piWebConfigParsing -> config.ts 环境/默认值
  -> Web 与 daemon 启动配置
  -> configRoutes -> 客户端解析 -> settingsConfigDraft / 设置面板
项目 .pi-web/config.json -> projectPiWebConfig -> 工作区有效配置
```

UI 保存的是受支持配置，不应该把密码 hash、服务端秘密或不属于目标机器的字段原样回写。selected-machine 路由通过明确键集合限制修改范围，不能直接复用网关完整配置保存。

## 状态与合并规则

全局用户/机器配置位于 `$PI_WEB_CONFIG` 或默认 `~/.config/pi-web/config.json`，Web 与 daemon 必须使用同一有效配置。项目核心配置只使用一个可提交文件 `<project>/.pi-web/config.json`，新功能添加键而非创建独立核心配置文件；插件可拥有 `.pi-web/tasks.json` 等文件。

`$PI_WEB_DATA_DIR` 默认 `~/.pi-web`，保存 `projects.json`、`machines.json`、插件发现状态、daemon IPC/认证及普通项目 credential/model store，是托管状态而非用户配置 API。认证与模式 × 项目偏好的精确路径和首次初始化规则见[认证与模型](auth-models.md)。联邦设置以所选机器为目标，但 gateway bind/allowed-host、机器注册/token 和浏览器快捷键仍属于网关/浏览器。

| 层 | 所有者 | 修改约束 |
| --- | --- | --- |
| 全局配置路径/环境 | config.ts 与启动环境 | Web/daemon 对齐，路径切换不自动迁移数据 |
| 全局解析/序列化 | shared/piWebConfigParsing | 输入 unknown，校验后转类型；读写语义一致 |
| 所选机器配置 | configRoutes 的键白名单 | 不能修改网关专属监听/注册设置 |
| 项目有效配置 | projectPiWebConfig | 目录覆盖、允许路径合并；不把任意全局键开放给项目 |
| 设置编辑草稿 | settingsConfigDraft 与面板 | 切机器不能提交旧草稿到新目标 |
| 模型/思考默认值 | projectSettingsScope | 模式 × 项目独立，不回写全局 agent 设置 |

## 新增配置的修改顺序

1. 明确用户需求、作用域、默认值和生效时机，优先扩展现有 config 文件。
2. 修改 shared 类型和解析/序列化；需要环境覆盖时在 config.ts 显式处理。
3. 如果机器级可修改，更新 selected-machine 白名单；若支持项目覆盖，再修改项目解析与合并。
4. 更新 API 响应解析、设置草稿和 owning 面板，不在 PiWebApp 手写转换。
5. 在实际消费该值的服务中验证行为；涉及 daemon 启动快照的配置不能承诺即时生效。
6. 同步 config.md/config.html，添加需要的 Changeset；标明 Web、daemon 或两者重启。

参数存在、类型正确与最终有效值是三层不同断言。测试默认值、显式设置、环境覆盖、项目覆盖和远端保存；错误类型应拒绝，不能通过类型断言绕过。秘密不能因为新增字段被带到公开响应或日志。

## 定位与回归

- [config.ts](../../src/config.ts)、[config.test.ts](../../src/config.test.ts)：路径、环境、默认值。
- [piWebConfigParsing.ts](../../src/shared/piWebConfigParsing.ts)：共享配置边界。
- [configRoutes.ts](../../src/server/configRoutes.ts)、[路由测试](../../src/server/configRoutes.test.ts)：完整与所选机器配置分离。
- [projectPiWebConfig.ts](../../src/server/workspaces/projectPiWebConfig.ts)、[项目测试](../../src/server/workspaces/projectPiWebConfig.test.ts)：工作区有效配置。
- [settingsConfigDraft.ts](../../src/client/src/components/settings/settingsConfigDraft.ts)、[草稿测试](../../src/client/src/components/settings/settingsConfigDraft.test.ts)：编辑与保存。
- [settingsMachineTarget.test.ts](../../src/client/src/components/settings/settingsMachineTarget.test.ts)：设置目标机器。

“保存成功但没生效”先区分保存目标、环境覆盖和服务重启，不直接修改托管数据。跨进程配置变化按[运维](../admin/operations.md)对齐两端。
