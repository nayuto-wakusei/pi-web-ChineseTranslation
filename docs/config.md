# PI WEB 配置参考

本页说明机器与项目配置、路径访问、上传和提示词附件、会话守护进程能力、插件期望状态与恢复、快捷键以及运行时环境。便于扫描的默认值、作用域和重启规则见[配置页面](https://pi-web.dev/config)。

<a id="config-files"></a>
## 配置文件

- **部署默认值**：可选 `PI_WEB_DEFAULTS_CONFIG` 指向只读、同 schema JSON；没有默认路径。显式选择缺失、格式错误或无效文件会失败，不能与可写配置共用路径，两个服务必须使用同一选择。
- **机器配置**：`$PI_WEB_CONFIG`；未设置时使用 `$XDG_CONFIG_HOME/pi-web/config.json` 或 `~/.config/pi-web/config.json`。
- **项目配置**：`<project>/.pi-web/config.json`，可提交到仓库。
- **托管数据**：`$PI_WEB_DATA_DIR`（默认 `~/.pi-web`），不是用户可编辑配置 API。

联邦模式下，会影响工作执行的设置针对所选机器：路径访问、上传/附件默认目录、上传限制、会话工具、插件启用与配置。网关 host/port/allowed-hosts、快捷键、机器注册和令牌仍保存在网关。远端不支持某项功能时明确报错，不静默使用网关配置。

Pi 包由目标机器的 `pi install`、`pi remove`、`pi update` 或 **设置 → Pi 包** 管理；PI WEB 的 `plugins` 只控制已发现的纯浏览器、纯服务端与双入口插件的期望状态，不安装、移除或更新包。

<a id="settings-target-and-drafts"></a>
### 设置目标与草稿

普通模式的设置对话框独立持有“配置机器”选择，只改变机器级设置的目标，不切换正在使用的项目、工作区或会话。网关配置、默认主题和快捷键仍属网关，浏览器主题覆盖仍属设备。存在未保存的文件访问或上传草稿时，切换设置机器前需确认放弃或继续编辑；管理模式不开放这套普通跨机器选择器。

通用设置分别持有网关与目标机器草稿：配置刷新只更新未编辑字段，不用其他机器的值重设当前草稿；保存返回的配置确认已提交值后，才结清对应提交，保存期间的新编辑仍保留。快捷键按操作行确认保存值，只清该行已提交且未再改动的草稿；回调结束本身不是保存确认，也不清其他行草稿。

<a id="chinese-language-plugin"></a>
### 中文语言插件

内置 `zh-cn` 默认启用，覆盖核心界面、内置插件、CLI 及 PI WEB 自有提示。要恢复英文，在有效机器配置中设置 `"plugins": { "zh-cn": { "enabled": false } }`。设置中的语言与区域可独立选择界面语言、格式区域、时区和时制，缺失词条回退英文。浏览器语言选择不改变 CLI/服务端语言。

浏览器的默认中文由网关 zh-cn 插件提供，并服从网关语言默认值、设备选择及环境强制策略，不随所选远端机器切换。每台机器的 CLI 和服务端读取自身配置；远端返回的提示保留远端语言。用户内容、模型回复、第三方输出、命令、错误码及协议字段不会被翻译。

修改后刷新网页；CLI 下次启动生效；服务端需重启。拆分部署时重启 `pi-web-sessiond.service` 和 Web 服务（开发安装为 `pi-web-ui-dev.service`），确保两者使用相同有效 `PI_WEB_CONFIG`。浏览器语言与区域设置可即时切换；插件启用和服务端词典变更仍按上述刷新/重启规则生效。

普通模式模型凭据和自定义模型按注册项目存放在托管目录的 `auth.json`、`models.json`。同一项目所有工作区共享项目存储；首次使用从有效全局 Pi agent 文件复制一次，之后不回退或覆盖。认证、启动与列表请求必须解析到注册项目；运行中的会话保留创建时的项目 registry，即使项目之后关闭。管理嵌入使用独立的 `management-embed/auth.json` 与 `models.json`，不混用普通项目凭据。

### 已安装服务的自定义配置路径

`start`、`restart`、`doctor` 的就绪检查默认使用已安装服务保存的配置路径；命令的非空 `PI_WEB_CONFIG` 可覆盖。`doctor` 检查受管理安装，不代表所有自定义环境。

| 情况 | 行为或处理 |
| --- | --- |
| 使用已安装路径 | 正常执行 `pi-web start`、`restart`、`doctor` |
| 单次命令覆盖 | 设置非空 `PI_WEB_CONFIG`，不重写服务定义 |
| 更改服务路径 | `pi-web install --config /path/to/config.json` 重新生成 Web/API 和 daemon 定义 |
| 旧安装仅 Web 保存路径 | 重跑上述安装命令，对齐两个服务 |
| systemd 无法验证实际环境 | 管理器状态过期、实际 fragment 不同或管理值不可验证时失败，不猜测；受管理 `Environment=`（当前 `PI_WEB_CONFIG`）必须与定义一致；无关变量忽略，未改管理值的 drop-in 允许 |
| systemd 使用 `EnvironmentFile=` | 本地保留严格检查：无法验证文件内实际覆盖时失败，不采用上游仅警告的宽松策略 |
| launchd 使用旧路径或其他 plist 标签 | `start`/`doctor` 失败；`restart` 重新加载已安装 plist，可修复过期状态 |

<a id="startup-model-and-thinking-defaults"></a>
## 新会话模型与思考默认值

在模型或思考等级选择器中点击“新会话默认值”星标。实心星标表示已保存的默认值；点击选项本身只改变当前会话，星标不改变当前会话。

`defaultProvider`、`defaultModel`、`defaultThinkingLevel` 按机器上 **模式 × 项目** 保存至托管 `settings.preferences.json`，不写回共享 agent `settings.json`。普通模式与项目认证同目录；管理模式使用 `management-embed/projects/<hash>/`，不能唯一归属项目时使用 `management-embed/orphan/<cwdHash>/`。普通模式的 `enabledModels` 也按项目保存，管理模式不展示。

默认值无需重启，适用于新会话。项目 Pi 设置、显式启动选择及每模型思考设置仍有既定优先级。默认模型必须启用，否则选择首个启用模型。恢复会话保留原模型与思考等级。其他共享 agent 设置（包、扩展、代理等）继续读真实 agent 目录的 `settings.json`。

<a id="default-theme-and-streaming"></a>
<a id="theme-default-and-device-choices"></a>
## 应用主题与发送默认值

网关初始 HTML 携带默认主题详情与 CSS，Auto 包含配对两种变体；不评估主题包代码即可提供静态主题。初始默认主题不在静态目录中（例如旧运行时主题、插件已禁用或未知 ID）时先用 Classic 显示，同时保留原偏好；此引导回退不适用于显式主题查询。设备覆盖按需请求，失败或不可用时保持已提交配色而不抹掉选择；设置页每个对话框首次进入通用页加载完整主题目录，失败可显式重试。主题资产使用带 revision 的 URL 与 HTTP 缓存，不把任意 CSS 写入 localStorage，也不增加配置文件。

`defaultTheme` 是网关配置，形如 `{ "themeId": "plugin-id:theme-id", "auto": true }`：`themeId` 必须为限定贡献 ID，`auto` 必须为布尔值。`auto: true` 在该主题有明暗配对时跟随系统明暗，否则使用所选主题。除环境强制主题外，浏览器设备已保存的主题覆盖优先；主题暂不可用时使用回退，不删除原选择。主题属于整个应用，不保存到当前远端机器；保存/刷新配置后生效，无需重启 daemon。

在 **设置 → 通用 → 主题** 中，“在此设备使用”保存浏览器覆盖，“设为默认”保存网关默认且不覆盖已有设备选择，“使用默认值”清除此浏览器覆盖并采用应用默认。设置页的“默认主题”说明与应用的默认选择一致；网关未显式配置 `defaultTheme` 时，使用内置 `themes:pi-web-dark`，并在 `auto: true` 下跟随系统在 PI WEB Light / Dark 之间切换。读取默认值或清除设备覆盖均不写入网关配置。Auto 只在主题有明暗配对时跟随设备。

内置 **Custom UI Codex** 展示插件默认启用，配置 ID 为 `pi-web.custom-ui-codex`。它只提供可选的本地视觉与布局定制，不提供应用默认主题。在网关的插件设置中禁用，或在网关有效机器配置设置 `plugins["pi-web.custom-ui-codex"].enabled: false`，刷新页面后恢复上游默认布局与样式；中文语言插件与权限模式不受影响，无需重启 daemon。远端机器不能替网关接管整个应用界面。

该插件不再通过浏览器 `activate` 注册主题；其配色与明暗配对改为 `package.json` 的静态 `themes` / `themePairs` 声明，并与其他静态主题一样由网关目录收集。Paper / Graphite 等内置配色也由静态目录提供，限定 ID 为 `themes:paper`、`themes:graphite` 和 `themes:paper-graphite`；这些 ID 直接指向内置静态主题，不再是映射到 Custom UI Codex 的旧别名。旧插件命名空间的同名静态主题仍保留，供已保存的显式 `pi-web.custom-ui-codex:` ID 继续解析；它们不是默认值，也不改变内置 `themes:*` 选择。已有设备或网关主题选择照常优先。读取和显示不改写原有配置；主题暂不可用时保留原选择并显示回退，设置页标记该主题不可用，不把回退主题当作原选择保存。

网关 `defaultStreamingBehavior` 为 `"steer"`（默认）或 `"followUp"`，决定流式工作期间编辑器的默认发送方式，不改变已在 daemon 中排队的消息。浏览器分区尺寸、编辑器偏好与普通导航顺序不是新的项目配置文件；导航顺序是按机器管理的托管状态，管理模式不共用普通存储。

<a id="session-naming-and-archives"></a>
## 会话命名与归档

<a id="session-naming"></a>

自动命名由随包提供的 **Session naming** Pi 扩展（`@jmfederico/pi-session-naming`）负责，依据新对话的首条提示命名；使用同一有效 Pi profile 的 TUI 也会加载它。可在 **设置 → Pi 包** 移除以使用其他命名扩展，或从“可用包”重新安装；包变更对新会话生效。

在 `<active-agent-profile>/session-naming/config.json`（通常是 `~/.pi/agent/session-naming/config.json`）配置以下可选字段，不再使用核心 `sessionNaming` 配置或命名设置面板：

| 字段 | 默认值 | 契约 |
| --- | --- | --- |
| `model` | 当前会话模型 | 精确 `provider/model-id`，仍使用原会话普通项目或管理 registry |
| `maxTokens` | `24` | 正安全整数；提供器可能将 reasoning 计入该预算，不是标题字数 |
| `thinkingLevel` | `minimal` | `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；受模型能力限制 |
| `timeoutMs` | `10000` | 模型加载及生成总耗时，整数 `1..2147483647` 毫秒 |

文件编辑用于下次命名请求，删除字段恢复默认，`{}` 重置文件覆盖。`PI_WEB_SESSION_NAMING` 仍可用 JSON 对象强制指定字段，修改后重启相关进程。命名不切换聊天模型或把项目凭据切换为全局凭据；失败时扩展报告错误并使用提示词开头作为回退名称。

加载核心配置时，旧 `sessionNaming` 值迁移到包文件；已有包配置优先。迁移成功后删除可写核心配置中的旧键；部署默认文件中的旧项需按日志检查目标包文件后手动移除。核心配置 API 拒绝已退役的键。迁移失败保留旧键并继续启动，下次加载重试；修复前命名可能使用已有包配置或默认值。

<a id="session-archive-directory"></a>

`sessionArchive.directory` 选择新归档内容目的地，非空环境变量 `PI_WEB_SESSION_ARCHIVE_DIR` 优先；默认 `$PI_WEB_DATA_DIR/archived-sessions`。配置路径或环境路径相对进程 cwd 解析为绝对路径，daemon 启动后固定，修改需重启 daemon。归档索引仍是 `$PI_WEB_DATA_DIR/archived-sessions.json`，已有记录继续指向原归档文件，不自动迁移。备份时覆盖索引、旧目录与新目的地，不只复制默认目录。

<a id="mcp-settings-and-authentication"></a>
## MCP 设置与认证

**设置 → MCP** 管理所选机器当前非归档会话中已启用、支持 OAuth 的 MCP 服务器认证；先选择可写、空闲且可信的会话。普通会话的服务器配置读取共享 Pi agent 全局根及可信项目；完整特权管理读取管理私有配置根及可信项目，不读取共享 agent 全局根。项目配置遵循 Pi 的信任规则，这里不新增 `pi-web` MCP 服务器配置键，也不替代管理模式的 Workbench 受控 MCP 集成。

也可从操作面板选择 MCP 登录/注销，再选择服务器；设置页直接针对所选服务器。两者使用同一独立认证流程，不切到聊天；禁用、header 认证或 stdio 服务器不列为 OAuth 候选，同机器同时只能进行一项 MCP 认证操作。

专用认证仅支持所选 **Pi 1.3.0 或 1.4.0** 同一 SDK 的内部凭据适配，未知版本不保证兼容。普通项目与管理使用独立私有 MCP 凭据，不回退共享 agent 的 MCP OAuth 存储；完整特权仍是管理身份，受限管理不提供该流程。认证固定原机器、会话、cwd、项目和 scope，切换选择不会转移流程。注销删除对应保存凭据，影响使用该凭据的其他会话，但不禁用服务器或撤销提供方授权。详见[认证与模型](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/modules/auth-models.md#mcp-认证)。

## 浏览器请求安全

在 **设置 → 常规 → 允许的主机名** 配置网关 `hostAccess`。推荐显式列出反向代理对外使用的主机名：`{"mode":"restricted","hosts":["pi.example.com"]}`。`{"mode":"any"}` 关闭应用层主机名限制；不设置时生产网关兼容旧行为，开发 UI 继续使用旧的 `allowedHosts`。HTTP 与 WebSocket 的浏览器 Origin 检查不随主机名策略关闭。

`PI_WEB_HOST_ACCESS` 可用同样的 JSON 强制覆盖。策略只属于当前网关，不写入工作项目或远端机器配置。修改后重启 Web/API 和正在运行的开发 UI，无需重启会话 daemon。

<a id="reverse-proxy-deployment-paths"></a>
## 反向代理部署前缀

PI WEB 不需要专门的 URL 前缀配置。同一发布产物可用于 `/`、`/ai/`、`/test/ai/`。代理必须先把不带尾斜线的前缀重定向到带斜线地址，再剥离前缀转发同一认证范围的 HTTP 与 WebSocket。页面相对资源和 PWA 路径依赖这一契约，详见[反向代理安装指南](https://pi-web.dev/install#reverse-proxy-prefix)。

管理换票入口遵循同一前缀：`entryPath` 由平台用带尾斜线的外部应用 base URL 解析一次，不能相对 POST 地址解析。旧 `?embed=management&token=` 长链接仍可能触发 nginx `414`；这是请求行限制，与 `client_max_body_size` 无关，推荐平台改接换票，单独升级不会自动改写旧链接（管理员可临时调高反向代理请求行限制缓解）。见[短入口换票](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/admin/management-audit.md#management-entry-tickets)。

<a id="precedence"></a>
<a id="precedence-and-reloads"></a>
## Precedence and reloads

Highest priority first, for layers applicable to that setting:

```text
enforced environment > browser-local choice > supported project override
  > writable global config > deployment defaults > built-in defaults
```

Browser-local choices apply to colour theme, file icon theme, and localization. Project config participates only for supported keys. Environment policy wins over both; it is not a default that projects or browsers can override.

Each declared setting replaces its lower-priority value, including arrays and dictionaries; there is no general recursive merge. The schema declares these namespace leaves: `uploads.defaultFolder`, `attachments.defaultFolder`, `speech.endpoint`, `speech.api`, `speech.model`, `speech.language`, `speech.apiKey`, `speech.apiKeyEnv`, `speech.timeoutMs`, `speech.maxAudioBytes`, `sessionArchive.directory`, `pathAccess.allowedPaths`, and `defaultLocalization.language`, `.formatLocale`, `.timeZone`, `.hourCycle`. Each inherits independently across deployment defaults, writable config, applicable project config, and environment policy. An empty namespace `{}` contributes no overrides; missing leaves inherit.

Each plugin's `enabled` and each top-level `plugins.<id>.settings.<key>` also resolve independently. An individual array/dictionary-valued setting still replaces entirely, including an explicit empty value. `defaultTheme` remains one atomic, coherent preference; `shortcuts` and deprecated `agent` are also atomic. JSON depth alone does not define a setting. Path additions have the separate composition rules below.

### Environment policy

Every nondeprecated runtime core config key has an environment override named `PI_WEB_<SNAKE_CASE_KEY>`. Strings and numbers use scalar values; object/array settings use JSON. See the matrix below for names. Offline plugin recovery state is managed separately by the recovery CLI. For example:

```sh
PI_WEB_INSTALLATION_NAME='Build lab'
PI_WEB_BASE_PATHS='["/opt/reference"]'
PI_WEB_UPLOADS='{"defaultFolder":"manual/uploads"}'
PI_WEB_DEFAULT_LOCALIZATION='{"timeZone":"UTC"}'
PI_WEB_PLUGINS='{"git":{"settings":{"workspaceDiscoveryHooks":false}}}'
```

Container JSON variables keep their existing names: `PI_WEB_UPLOADS`, `PI_WEB_ATTACHMENTS`, `PI_WEB_SPEECH`, `PI_WEB_SESSION_NAMING`, `PI_WEB_SESSION_ARCHIVE`, `PI_WEB_PATH_ACCESS`, and `PI_WEB_DEFAULT_LOCALIZATION`. Only supplied namespace leaves are enforced, including `pathAccess.allowedPaths` and plugin leaves; `{}` enforces none. Atomic settings lock the whole value. `PI_WEB_PORT` retains the `PORT` fallback; a nonempty `PI_WEB_SESSION_ARCHIVE_DIR` alias wins over `PI_WEB_SESSION_ARCHIVE` JSON. `PI_WEB_ALLOWED_HOSTS` accepts JSON `true` or a string array, plus legacy `true`/comma-separated hosts. Allowing all hosts is unsafe for an exposed development server; prefer an explicit list.

Boolean environment inputs accept only `true`/`false` (case-insensitive) or `1`/`0`. Invalid supplied policy values fail startup instead of being ignored. Unknown fields in declared core containers are errors, including misspellings in `pathAccess`, `uploads`, `attachments`, and `speech`. Plugin environment envelopes accept only `enabled` and `settings`; keys inside `settings` remain plugin-owned. Unset a variable to remove enforcement; empty strings are not a general reset syntax. Legacy empty host, port, allowed-hosts, upload-limit, and archive-directory overrides remain ignored. Runtime-only variables have their own contracts; see offline flags below. Markers such as `PI_WEB_SESSION` are not config policy.

### Sources, saves, and resets

Settings identifies inherited sources and environment-enforced values. Enforced controls are read-only. Where a saved override has a **Reset saved override** control, resetting deletes that override and exposes the next applicable layer; it does not copy today's effective default into the writable file. Loading deployment defaults keeps them separate from writable overrides. Theme and localization enforcement temporarily masks saved browser choices without erasing them; removing policy restores those choices.

The config API returns `config` (writable overrides), `effectiveConfig`, optional `defaultsPath` / `defaultsConfig`, `configSources` (JSON-pointer identifiers mapped to `defaults`, `config`, or the controlling environment variable), and `enforcedSettings` (identifiers mapped to environment variables). Source and enforcement pointers address declared leaves, such as `/defaultLocalization/language` and `/pathAccess/allowedPaths`; the archive alias reports `/sessionArchive/directory`. Missing source entries inherit built-in/feature defaults; this is machine metadata, not browser/project provenance.

Use `PATCH /api/config` for explicit updates, or `PATCH /api/machines/<machineId>/config` for selected-machine-supported keys (`local` selects the gateway machine). The body has optional `set` (config-shaped values) and `unset` (JSON-pointer strings):

```json
{
  "set": { "quietMode": true },
  "unset": ["/defaultTheme", "/defaultLocalization/timeZone", "/plugins/git/settings/workspaceDiscoveryHooks"]
}
```

`unset` accepts known leaf pointers such as `/defaultLocalization/language`, `/uploads/defaultFolder`, and `/pathAccess/allowedPaths`, as well as container resets such as `/defaultLocalization`. Atomic settings reset at their top-level pointer, such as `/defaultTheme`. UI container-group resets remove only unlocked saved leaves in one request. An API container reset overlapping any enforced leaf is rejected, preserving saved choices hidden by enforcement. Escape `~` as `~0` and `/` as `~1` within pointer segments: a plugin setting named `a/b~c` uses `/plugins/git/settings/a~1b~0c`. Conflicting set/unset targets and changes to enforced settings are rejected. There is no null reset sentinel: `null` retains its schema-defined meaning, such as disabling a shortcut. Existing `PUT` endpoints remain available. They retain replacement semantics for unenforced settings, but omitted enforced settings preserve their hidden saved values. Supplying a different saved value for an enforced setting is rejected; unchanged saved values may round-trip. This protection also applies when no saved override exists: a legacy save cannot create one for an enforced setting. Federated protection requires the target to report enforcement metadata; upgrade older peers before relying on it.

### When changes apply

Process restarts depend on the key:

- `host` / `port`: restart the gateway web/API service or process.
- `maxUploadBytes`: restart both the web/API process and the session daemon on that machine.
- `spawnSessions` / `subsessions` / `sessionMessages` / `askUser` / `extensionDialogsTimeoutMs` / `environmentFacts`: restart the session daemon on that machine.
- `sessionArchive.directory`: restart the session daemon on that machine; changes only the destination for new archives.
- Session naming: the removable Pi package reads its file for each new title; old core settings migrate on config load. See [Session naming](#session-naming).
- `pathAccess`: applies on the next request; existing file views may need a browser refresh.
- `uploads.defaultFolder`: applies to newly opened Files upload dialogs and new direct drag/drop batches after config/workspace refresh.
- `attachments.defaultFolder`: applies to new prompt-attachment saves after config/workspace refresh.
- `speech.*`: the session daemon reads it once at startup because it also decides whether the runtime advertises `prompt.speechRecognition`; restart that machine's daemon to change it. The browser refreshes the control on the next runtime status read.
- `plugins`: browser-only changes need a tab reload. Server-backed enablement, settings, or package changes require a manual session-daemon restart, then a tab reload. See [Project plugin settings](#project-plugin-settings).
- `serverPlugins.safeStart`: persistent offline recovery state applied before server-plugin discovery/import on the next sessiond start; use the `pi-web plugins safe-start ...` CLI rather than hand-editing it.
- Pi package changes: use `/reload` in each idle session for ordinary extensions, skills, templates, and themes. Packages containing server plugins require a manual session-daemon restart and browser reload. Global provider registration or connection changes also require a daemon restart; model-list-only updates do not. See [Pi extension provider baseline](#pi-extension-provider-baseline).
- `shortcuts` / `defaultStreamingBehavior` / `quietMode`: saved settings apply in the browser after config refresh/save; no service restart.
- `defaultTheme`: applies after settings save or browser config refresh when the browser inherits it or environment policy enforces it; no service restart.

### Localization defaults

Set `defaultLocalization` in the gateway's global config to supply browser defaults:

```json
{ "defaultLocalization": { "language": "en", "formatLocale": "de-DE", "timeZone": "Europe/Berlin", "hourCycle": "h23" } }
```

All fields are optional and independent. `language` requests installed translations, with English fallback. `formatLocale` is a standard locale tag. `timeZone` is validated by native `Intl`; omitted zones use the device zone. `hourCycle` accepts `h11`, `h12`, `h23`, or `h24`; omission uses regional conventions. In this fork, omitted UI language uses the bundled zh-cn language preference (English when that plugin is disabled); omitted format locale uses the browser language. No currency or zone is inferred from language. Development pseudo locales cannot be configured here.

Saved browser preferences override defaults independently per field unless that field is enforced by `PI_WEB_DEFAULT_LOCALIZATION`. Settings → General → Language and region saves only explicit browser-local choices, not this server setting. Empty Regional format and Time zone fields inherit the configured gateway value, if any, otherwise the browser’s value; the source and value are shown below each field. Clear a field and apply to resume inheritance for that field, or choose **Use defaults** to clear all local overrides. Existing saved snapshots remain explicit overrides until cleared. Reload the tab after changing config defaults; no service restart is needed. This key is gateway-only, not selected-machine or project-local. Omitted fields inherit lower layers; `{}` adds no overrides, so use reset/unset to remove saved fields.

### Streaming send default

In **Settings → Keyboard shortcuts → Send while agent is running**, choose **Steer** (the default) to deliver input before the next model call, or **Follow-up** to queue it until the current response finishes. This changes only the keyboard shortcut, not the chat buttons. During compaction, messages queue as follow-ups.

The global gateway key is `defaultStreamingBehavior`: `steer` or `followUp`. It is not project-local and needs no service restart.

### Quiet mode

Quiet mode collapses agent activity in the transcript. Tool calls, thinking, results, and skill loads stay in the conversation but start inside one expandable **live events** / **events** summary line instead of being expanded while the agent works. Conversation text, question forms, and tool output images are unchanged.

Turn it on in **Settings → General → Chat display → Quiet mode**. It is off by default. The global gateway key is `quietMode`; it is not project-local and needs no service restart. Devices share the gateway setting, so it is not a per-browser preference.

```json
{ "quietMode": true }
```


## Machine name

Set `installationName` in the machine's config, enforce it with `PI_WEB_INSTALLATION_NAME`, or edit **Settings → General → Machine name** for the selected machine:

```json
{ "installationName": "Build lab" }
```

The name replaces the local machine's label and remains visible when there is only one machine, in browsers and installed PWAs. Empty or unset names use **PI-WEB**. Names are trimmed and limited to 120 characters without control characters. This setting is machine-global, not project-local, and needs no restart; reload other open windows to refresh their labels.

Federated gateways use the remote machine's reported name unless you set a **Local display name**. Clear that field to use the remote machine's name again. Existing registry names remain overrides. An unavailable or older remote without a reported name uses **PI-WEB**; a previously discovered name is retained while the gateway process stays running.

The PWA manifest uses the gateway's installation name, with **(dev)** appended for development deployments. Changing the selected remote machine does not rename the installed gateway app. Browsers control when existing launcher names update; reinstall the PWA if its old name remains.


### File icon theme

**Settings → General → File icons** selects a complete icon set for Files and Git in this browser, independently of the colour theme. Git uses filename colours and status labels to distinguish changes without tinting the file-type artwork. Material is included locally and selected by default. Its file-type shapes render in one muted grey supplied by the active colour theme, without separate light/dark assets. Choose generic file icons to disable themed icons, or reset the browser choice to return to Material. Unavailable saved themes temporarily fall back to Material without erasing the choice. If Material is unavailable too, Files uses generic icons. Directory expand/collapse indicators remain unchanged.

This is a browser-only preference, with no gateway default, project setting, or environment override. See [file icon contributions](plugins.md#file-icon-themes) for additional icon sets.


### Path composition

`basePaths` supplies machine-wide roots. Without environment enforcement, `pathAccess.allowedPaths` adds global and supported project roots, deduplicated after base roots. `PI_WEB_PATH_ACCESS` with `allowedPaths` replaces those additions, not the base roots. `PI_WEB_UPLOADS`, `PI_WEB_ATTACHMENTS`, and `PI_WEB_PLUGINS` enforce supplied leaves over project values.


管理集成、管理权限及跨进程审计配置变化仍要求 Web/API 与 daemon 对齐并重启；分层配置不改变普通项目凭据与管理身份隔离。

<a id="global-config-example"></a>
## 全局配置示例

```json
{
  "host": "127.0.0.1",
  "port": 8504,
  "pathAccess": { "allowedPaths": ["~/SDKs", "/opt/reference"] },
  "uploads": { "defaultFolder": ".pi-web/uploads" },
  "attachments": { "defaultFolder": ".pi-web/attachments" },
  "maxUploadBytes": 67108864,
  "sessionArchive": {
    "directory": "/srv/pi-web/archives"
  },
  "spawnSessions": true,
  "subsessions": true,
  "sessionMessages": true,
  "askUser": true,
  "extensionDialogsTimeoutMs": 300000,
  "environmentFacts": true,
  "plugins": { "workspace-tasks": { "enabled": true }, "updates": { "enabled": false } }
}
```

合并到已有文件，不覆盖无关设置或用户数据。

<a id="project-local-config-example"></a>
<a id="project-local-config"></a>
## 项目配置示例

```json
{
  "version": 1,
  "pathAccess": { "allowedPaths": ["~/project-reference"] },
  "uploads": { "defaultFolder": "manual/uploads" },
  "attachments": { "defaultFolder": "prompt-attachments" }
}
```

路径根必须是宿主绝对路径或 `~` 前缀，不支持相对根。项目上传/附件目录通过工作区有效配置返回，联邦访问使用目标项目的值；不依赖旧远端可选字段回退。插件可拥有独立文件，如 `.pi-web/tasks.json`。

<a id="project-plugin-settings"></a>
### 项目插件设置

支持项目设置的服务端插件可读取注册项目根目录的 `.pi-web/config.json` 中 `plugins.<id>.settings`，不是各 worktree 独立配置。未被环境强制的项目顶层设置键覆盖机器值，嵌套对象整体替换而非深合并；`enabled` 仍只属于机器配置，项目声明会被拒绝。修改服务端插件的全局或项目设置后，手动重启目标 daemon。

<a id="git-worktree-discovery-hooks"></a>
### Git 工作树发现通知

Git 插件的 `plugins.git.settings.workspaceDiscoveryHooks` 为布尔值，默认 `true`，未被环境强制时项目值覆盖机器值。支持命名 hooks 的 Git（2.54+）可安装自身命名通知，保留已有 hooks 且不修改 `core.hooksPath`；不支持时仍可按需刷新列表。通知仅提示宿主重新查询当前提供器，不直接注册工作区。修改后重启 daemon，浏览器刷新不能更新 hook 状态。

<a id="git-instance-namespace"></a>

多实例可用 daemon 环境变量 `PI_WEB_INSTANCE_NAMESPACE` 区分通知身份：1–32 个字母、数字、下划线或连字符，首字符为字母或数字；生产默认留空，开发实例使用 `dev`。名称应保持稳定；退役旧名称时先在旧名称下禁用发现 hooks 并重启完成清理，再切换名称。不自动接管或迁移其他实例/旧名称的 hook。

<a id="worktree-pre-remove-hook"></a>
## 工作区删除前钩子

在删除命令运行的工作区提供可执行 `.pi-web/hooks/worktree-pre-remove`，可清理绑定工作区的开发容器或其他资源。通常从项目主工作区运行，钩子可随仓库提交。

存在且可执行时，钩子与删除组成同一终端命令：

```sh
'<hook path>' '<workspace path>' && <workspace removal command>
```

Git 删除命令为 `git worktree remove '<worktree path>'`。

| 契约 | 行为 |
| --- | --- |
| 参数 | 恰好一个参数：被删除工作区的绝对路径 |
| 工作目录 | 删除命令执行的工作区，不是被删除的工作区 |
| 返回 0 | 继续删除 |
| 非零退出 | `&&` 失败关闭，工作区保留在磁盘 |
| 不存在或不可执行 | 当作无钩子，单独执行删除 |
| 无法探测且不是普通缺失 | 在关闭工作区终端之前失败 |
| 输出 | 与“删除工作区”终端命令一起展示 |

```sh
#!/bin/sh
# .pi-web/hooks/worktree-pre-remove
set -eu
worktree_path="$1"
# 停止绑定该工作区的开发容器，释放项目资源。
# 非零退出会阻止删除。
```

这是不限制工具的项目扩展点，不假定特定容器或资源管理系统。

<a id="configuration-matrix"></a>
## 配置矩阵

“机器”为所选机器；“网关”为当前浏览器连接的机器。环境强制始终优先于下表的项目或浏览器参与。`—` 为无配置文件键的纯环境变量。

| 配置 | JSON 键 | 环境变量 | 作用域 | 项目行为 / 生效 |
| --- | --- | --- | --- | --- |
| 机器名称 | `installationName` | `PI_WEB_INSTALLATION_NAME` | 机器 | 刷新配置；无项目覆盖 |
| 基础路径根 | `basePaths` | `PI_WEB_BASE_PATHS` | 机器 | 下次文件请求 |
| 语言区域默认值 | `defaultLocalization` | `PI_WEB_DEFAULT_LOCALIZATION` | 网关 | 刷新浏览器；字段独立 |
| 安静模式 | `quietMode` | `PI_WEB_QUIET_MODE` | 网关 | 默认 false；保存/刷新 |
| 监听地址 | `host` | `PI_WEB_HOST` | 网关 | 无项目键；重启 Web/API |
| 监听端口 | `port` | `PI_WEB_PORT`、`PORT` | 网关 | 无项目键；重启 Web/API |
| 允许的主机名 | `hostAccess` | `PI_WEB_HOST_ACCESS` | 网关 | 重启 Web/API 和开发 UI |
| 旧版开发允许主机 | `allowedHosts` | `PI_WEB_ALLOWED_HOSTS` | 未设置 `hostAccess` 时的网关开发 UI | 重启开发 UI |
| 外部路径根 | `pathAccess.allowedPaths` | `PI_WEB_PATH_ACCESS` | 机器 + 项目 | basePaths 后加全局/项目；环境替换添加项；下次文件请求 |
| 上传目录 | `uploads.defaultFolder` | `PI_WEB_UPLOADS` | 机器 + 项目 | 项目覆盖；新对话框/拖放批次 |
| 附件目录 | `attachments.defaultFolder` | `PI_WEB_ATTACHMENTS` | 机器 + 项目 | 项目覆盖；新附件保存 |
| 语音输入 | `speech.endpoint/api/model/language/apiKey/apiKeyEnv/timeoutMs/maxAudioBytes` | `PI_WEB_SPEECH` | 机器 | 未配置即关闭；重启 daemon |
| 请求大小 | `maxUploadBytes` | `PI_WEB_MAX_UPLOAD_BYTES` | 机器 | Web/API 与 daemon 重启 |
| 独立会话 | `spawnSessions` | `PI_WEB_SPAWN_SESSIONS` | daemon | 重启 daemon |
| 跟踪子会话 | `subsessions` | `PI_WEB_SUBSESSIONS` | daemon | 也需要 `spawnSessions`；重启 |
| 会话消息 | `sessionMessages` | `PI_WEB_SESSION_MESSAGES` | daemon | 独立于 spawn 开关；重启 |
| 问题表单 | `askUser` | `PI_WEB_ASK_USER` | daemon | 重启 daemon |
| 扩展对话框超时 | `extensionDialogsTimeoutMs` | `PI_WEB_EXTENSION_DIALOGS_TIMEOUT_MS` | daemon | 重启 daemon |
| 环境事实 | `environmentFacts` | `PI_WEB_ENVIRONMENT_FACTS` | daemon | 重启 daemon |
| 插件期望状态 | `plugins.<id>.enabled/settings` | `PI_WEB_PLUGINS` | 机器 | 浏览器刷新；服务端重启后刷新 |
| 项目插件设置 | `plugins.<id>.settings` | `PI_WEB_PLUGINS` | 机器 + 项目 | 支持的服务端插件顶层覆盖；重启 daemon |
| Git 发现通知 | `plugins.git.settings.workspaceDiscoveryHooks` | `PI_WEB_PLUGINS` | 机器 + 项目 | 默认 `true`；重启 daemon |
| Git 通知 namespace | — | `PI_WEB_INSTANCE_NAMESPACE` | daemon | 默认空；开发为 `dev`；重启 daemon |
| 插件恢复 | `serverPlugins.safeStart` | — | 机器离线恢复 | 下次 daemon 启动前应用 |
| 快捷键 | `shortcuts.<actionId>` | `PI_WEB_SHORTCUTS` | 网关 | 保存/刷新配置 |
| 默认主题 | `defaultTheme.themeId/auto` | `PI_WEB_DEFAULT_THEME` | 网关 | 浏览器覆盖优先；保存/刷新配置 |
| 流式发送默认方式 | `defaultStreamingBehavior` | `PI_WEB_DEFAULT_STREAMING_BEHAVIOR` | 网关 | `steer` 或 `followUp`；默认 `steer` |
| 归档目的地 | `sessionArchive.directory` | `PI_WEB_SESSION_ARCHIVE`、`PI_WEB_SESSION_ARCHIVE_DIR` | 所选机器 daemon | 重启；不迁移既有归档或索引 |
| 项目版本 | `version` | — | 项目 | 存在时必须为 `1` |
| 配置文件 | — | `PI_WEB_CONFIG`、`XDG_CONFIG_HOME` | 进程 | 改环境后重启；不是项目配置 |
| 托管数据 | — | `PI_WEB_DATA_DIR` | Web/API + daemon | 两进程对齐重启；不自动迁移数据 |
| daemon socket | — | `PI_WEB_SESSIOND_SOCKET` | Web/API + daemon | 两端一致并重启；默认 `$PI_WEB_DATA_DIR/sessiond.sock` |
| daemon TCP 端口 | — | `PI_WEB_SESSIOND_PORT` | daemon | 重启并同步 Web 的 URL |
| daemon TCP 主机 | — | `PI_WEB_SESSIOND_HOST` | daemon | 重启 daemon |
| Web 到 daemon URL | — | `PI_WEB_SESSIOND_URL` | Web/API | 重启 Web/API |
| 项目注册表 | — | `PI_WEB_PROJECTS_FILE` | Web/API + daemon | 高级状态覆盖；两进程重启 |
| 远端注册表 | — | `PI_WEB_MACHINES_FILE` | Web/API | 高级状态覆盖；重启 Web |
| Pi 状态目录 | — | `PI_CODING_AGENT_DIR` | daemon | 重启；包/插件/共享 agent 设置使用该目录 |
| Pi 会话目录 | — | `PI_CODING_AGENT_SESSION_DIR` | daemon | 独立会话存储覆盖；重启 |
| 跳过版本检查 | — | `PI_WEB_SKIP_VERSION_CHECK`、`PI_SKIP_VERSION_CHECK` | Web/API | 重启 Web；不禁止模型目录刷新 |
| 离线 | — | `PI_WEB_OFFLINE`、`PI_OFFLINE` | Web/API + daemon | 两进程重启；也禁用模型目录网络刷新 |
| Docker 开发 socket | — | `PI_WEB_DEV_SESSIOND_SOCKET` | Docker 开发环境 | 默认 `/data/pi-web/sessiond-dev.sock`；生成配置和健康检查使用此值，不改变生产 socket |

<a id="key-details"></a>
## 关键细节

<a id="ordinary-mode-tool-audit"></a>
### 普通模式工具审计

保留 Pino/服务日志，同时将普通模式工具调用元数据存入 `$PI_WEB_DATA_DIR/audit/normal-tool-calls.sqlite`；管理调用不进入该数据库。行包含会话、工作区、工具/call ID、起止时间、耗时及 `started`、`completed`、`failed`、`interrupted` 状态，不保存参数、结果、提示词、模型回复或凭据。

`auditLog.normalMode.enabled` 默认 `true`，`retentionDays` 默认 `90`，`maxRows` 默认 `500000`。daemon 启动和每 24 小时清理；数据库错误记日志，不停止工具。WAL 允许 daemon 活跃时读取；优雅关闭和下次启动将未完成调用标记为 interrupted。改变配置重启 daemon。

```bash
pi-web audit list --since 24h
pi-web audit list --status failed --since 7d
pi-web audit stats --since 30d
pi-web audit export --since 30d --format csv --output audit.csv
pi-web audit prune --before 2026-05-01
pi-web audit vacuum
```

<a id="management-mode-elasticsearch-audit"></a>
### 管理模式 Elasticsearch 审计

保留服务日志，可通过 `auditLog.managementMode.enabled: true` 与 `baseUrl`（或 `PI_WEB_AUDIT_ES_URL`）开启 Elasticsearch。认证只读 daemon 环境：`PI_WEB_AUDIT_ES_API_KEY` 优先，基本认证须同时有 `PI_WEB_AUDIT_ES_USERNAME`/`PI_WEB_AUDIT_ES_PASSWORD`；URL 禁止携带凭据。

按上海日历 ISO 周写入如 `pi-web-management-audit-2026-w32` 的索引，`indexPrefix` 默认 `pi-web-management-audit`，`retentionDays` 默认 `365`。daemon 安装严格模板，经 Bulk API 批写，启动/每日维护；上海日历每月首次成功维护删除早于截止的 `@timestamp` 文档。

记录 `user.id`、`user.root_user_id`、实际工作区所属授权项目、Pi 会话和适用的 Workbench Agent Session。受限和完整特权管理会话均在 `content` 中保留用户问题文本、模型可见回复（排除 `thinking` 块）、工具参数和结果；该字段只存储、不建立索引。服务日志仍仅记录元数据，管理调用不进入普通模式 SQLite。Workbench 专项能力、知识检索、Skill 事件仍只存固定资源版本、授权修订、run/trace ID、状态、耗时、重试或结果数量等元数据；同一调用作为工具执行时，其参数与结果按工具审计保存。不额外记录认证状态中的令牌、API key、cookie 或票据。

ES 错误记日志，不停止管理会话。有界内存队列重试，并在优雅关闭刷写；崩溃可能丢失尚未送达记录。正文及工具内容可能含敏感数据，须用 ES/Kibana 索引权限限制审计访问。共享跨进程配置保持 Web/API 与 daemon 一致；升级审计实现后需手动重启 `pi-web-sessiond.service`。

<a id="management-embed-guardrails"></a>
### 工作台嵌入护栏

在 sessiond 的服务环境中配置以下变量，重启 sessiond 后生效。先为试点实例设置共享硬规则模块、模型服务和工作台审计写入地址。两个模型阶段可分别从旁路切到强制。工具调用始终执行已启用的硬规则。

| 环境变量 | 值与作用 |
| --- | --- |
| `PI_GUARDRAIL_ENABLED` | 默认关闭。设为 `1` 或 `true` 后，对已验身的受限、单特权、双特权管理会话启用。普通密钥会话的护栏调用数为零。 |
| `PI_GUARDRAIL_MODULE` | 管理员安装的 `gxz-guardrails/src/index.mjs` 绝对路径。规则在 daemon 进程内调用，缺失或不可用时暂停受保护操作。 |
| `PI_GUARDRAIL_ENDPOINT` | 语义服务完整 URL，如 `http://127.0.0.1:18860/v1/decisions`。 |
| `PI_GUARDRAIL_TOKEN` | 模型服务与 sessiond 共享的 Bearer Secret。 |
| `PI_GUARDRAIL_INPUT_MODE` | 用户文本使用 Qwen3Guard-Gen-4B。默认 `shadow`，设为 `enforce` 后等待决定，命中时拒绝输入。 |
| `PI_GUARDRAIL_MATERIAL_MODE` | 外部文本使用 Horizon Small。默认 `shadow`，设为 `enforce` 后等待决定，命中时隔离材料并提供事件号。 |
| `PI_GUARDRAIL_TIMEOUT_MS` | 模型 HTTP 请求超时，范围 1–120000，默认 5000 毫秒，本机 CPU 联测使用 40000。 |
| `PI_GUARDRAIL_AUDIT_URL` | 工作台后端完整写入 URL，路径为 `/api/internal/guardrails/events`。 |
| `GUARDRAIL_AUDIT_TOKEN` | sessiond 与工作台后端共享的审计写入 Secret。轮换后需重启两端，使用它生成的项目、会话关联标识也会变化。 |

旁路异步提交，单个 daemon 最多同时保留 8 个待处理的语义检查。达到上限记录 `shadow_capacity`。模型命中或需要复核时记录 `shadow_hit`，业务流程继续。强制模式下，Qwen 需要复核时提示补充用途，必需的检测器超时或返回无效结果时暂停当前操作。审计在 Pi 数据目录的 `guardrails/pending.sqlite` 排队，按原事件 ID 跨重启补投至工作台。若 Pi 本地队列也无法落盘，受保护操作暂停，这次反馈事件号可能无法在管理员页查到。存储恢复后新发起的操作取得新事件号。用户可将事件号反馈给平台管理员，只有 `platform_admin` 能读取工作台护栏日志。 [管理嵌入与审计](admin/management-audit.md#工作台嵌入护栏)

<a id="workbench-and-mcp-integration"></a>
### Workbench 与 MCP 集成

`workbenchIntegration` 是管理嵌入的受控适配器，不限制普通会话。`baseUrl` 为服务器可访问的 Workbench 后端 origin，`mcpUrl` 为 MCP Streamable HTTP endpoint，两者必需。环境覆盖：`PI_WEB_WORKBENCH_URL`、`PI_WEB_MCP_URL`、`PI_WEB_WORKBENCH_TIMEOUT_MS`、`PI_WEB_MCP_TIMEOUT_MS`、`PI_WEB_SKILL_BUNDLE_MAX_BYTES`、`PI_WEB_SKILL_FILE_MAX_BYTES`、`PI_WEB_SKILL_FILE_COUNT_MAX`。

每次 Workbench HTTP 请求（含响应正文读取）的 `requestTimeoutMs` 默认 30000ms，显式配置继续生效，`PI_WEB_WORKBENCH_TIMEOUT_MS` 优先于配置文件。受控 MCP 能力调用的 `capabilityTimeoutMs` 默认 30000ms，`PI_WEB_MCP_TIMEOUT_MS` 优先于配置文件；这是排队、资源授权检查、签票、MCP 握手、能力调用及最多一次重试共用的总预算，各阶段不会重新获得完整预算。

受控客户端自动兼容有会话与无会话的 MCP Streamable HTTP 服务，无需新增 Pi 配置。初始化请求协议版本 `2025-06-18`，支持服务端协商为 `2025-03-26` 或 `2025-06-18`，后续请求携带协商后的 `MCP-Protocol-Version`。仅在服务端返回 session ID 时携带该 ID 并在结束时发送 `DELETE`；无会话模式不依赖 MCP 副本的粘性路由。这里的无状态支持属于 MCP 调用协议，PI WEB 的 daemon 会话归属与下述单 daemon 准入限额仍按现有边界运行。

受控 MCP 调用在单个 daemon 内默认最多同时执行 8 个，同一已验证用户最多同时执行 2 个；执行中与等待合计最多 32 个，其中同一用户最多 8 个；排队最多 2000ms。超限或等待到期会拒绝调用。这些准入限额为内部默认值，没有配置文件或环境变量覆盖，也不是跨实例总配额。取消会移除等待中的调用并中止进行中的 HTTP 请求。获得 MCP session ID 后，无论成功、异常或取消，均以独立的最多 1000ms 清理预算尽力发送 `DELETE`，因此返回可能包含这段额外等待；清理失败不替换原结果。取消与会话释放均不保证底层数据库查询已经停止。

每次逻辑能力调用读取一次当前资源授权；签票收到 401 时会重新核验。最多重试一次，仅限该授权刷新、尚未提交 `tools/call` 的握手临时失败，或服务明确标记可重试的执行前忙/排队超时（`native_executor_busy`、`native_queue_timeout`、`native_target_busy`、`native_client_busy`、`http_executor_busy`、`http_queue_timeout`）。重试使用新的一次性票据，等待 250–500ms 抖动并遵从更长的 `Retry-After`，仍计入原总预算。`tools/call` 结果不明时不自动重放。更新这些调用行为需重启 `pi-web-sessiond.service`；修改共享 endpoint 或配置时，Web/API 与 daemon 须保持一致并同时重启。

Skill bundle/file 上限 10485760/2097152 字节、文件数 200。适配器把一次性管理 token 换成私有 Agent Session，仅加载授权固定资源快照；并发同 entry token 复用该 Agent Session。

平台的浏览器入口同样先换票：应用相对 `POST api/management-entry-tickets`（JSON 正文 `{"token":"..."}`）返回 `201` 与 `{entryPath, expiresAt}`，不设置浏览器 Cookie；`GET management-entry?ticket=...` 兑换后写管理 HttpOnly Cookie 并 `303` 到 `./?embed=management`。票据一次性、最多 60 秒，最多 256 个待用票据且序列化上下文合计 8 MiB；`POST` 正文 1 MiB、编码上下文 1 MiB（`413`），daemon 内部 HTTP 头限额 1 MiB + 64 KiB，均不提高对外反向代理的请求行限制。换票响应使用 `no-store`，兑换响应附加 `no-referrer`。细节见[短入口换票](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/admin/management-audit.md#management-entry-tickets)。

受控工具为 `icnoc_search_capabilities`、`icnoc_call_capability`、`workbench_search_knowledge`、`workbench_retrieve_knowledge`、`workbench_retrieve_bookstack`、`workbench_read_bookstack`、`workbench_write_bookstack`、`workbench_get_bookstack_operation`、管理文件工具与 Bubblewrap 隔离的 `python`。知识检索使用后端短期一次性 token，BookStack 定向读取、写入和操作回执使用服务端 Agent Session Bearer；PI WEB 不配置 RAGFlow/BookStack 服务凭据，工具不接受 tenant/dataset ID。来源链接不是连接配置。全局开关允许时再提供 spawn/跟踪子会话/ask_user，子会话继承管理上下文及显式拒绝。

Python 与受限 bash 默认无网络，只绑定管理工作区及必要的只读运行库；bash 可在该工作区沙盒内执行命令，不默认暴露其他宿主目录。通用 MCP、HTTP、Web 搜索、宿主 shell 和交互终端默认拒绝。签名 token 的 `privileged.bash`/`privileged.network` 仅在机器 `managementEmbed.allowPrivileged: true`（默认 false）时生效；仅 tools.allow 不足以获得特权。单项授权仍采用受限模式，tools.allow/deny 继续有效：仅 bash 授权可提供工作区可写、其他宿主目录只读的沙盒；仅网络授权可启用 http/webfetch/websearch 并移除管理 Python/bash/terminal-command-runs 的 `--unshare-net`，但不增加宿主文件可见性。

**完整特权管理会话**要求机器 `managementEmbed.allowPrivileged: true`，且签名 token 的 `privileged.bash` 与 `privileged.network` 都为 true。此时代理使用与普通模式相同的 SDK 工具及资源加载机制，忽略管理 token 的 tools.allow/deny，不再应用管理工具的工作区沙盒和资源过滤。管理嵌入会话直接通过项目信任，无需普通页面预先批准，也不改写普通模式的信任决定。其宿主文件读写、网络和已配置 MCP 等能力受运行 daemon 的系统账号和普通权限配置约束，不代表自动获取操作系统 root 权限。

此模式不注册管理专属工作台工具及其“L0 只读能力”指令，不以工作台资源续期作为代理启动门槛，也不强制同步工作台 Skills 或覆盖项目 Relay 模板。工具定义和系统提示由普通会话相同的加载路径生成；已有项目文件不自动删除或改写，仍按普通模式加载。工作台外部服务自身的授权规则不会因此被改写。

平台标记的管理 AGENTS 指令，以及与签名上下文明确匹配的旧平台指令，不加入完整特权代理的系统提示；原文件不删除，用户自行编写的项目或全局指令保留。操作者的普通权限策略配置继续生效，不安装“全允许”策略，也不清空其环境配置。此切换仅影响代理运行时，不改变浏览器交互终端端点的独立授权。

已启用的[嵌入护栏](#management-embed-guardrails)也约束完整特权的工具调用。完整特权不改变管理身份、独立模型认证及偏好存储、审计或子会话管理上下文，也不允许普通会话连接读取管理会话。Web/API 与 daemon 的特权配置须一致。仅向受信任的签名入口发放双授权；旧管理 allow/deny 不能限制这种完整特权会话。

Skill bundle 只从 MCP origin 下载，校验授权固定版本与 manifest，写入管理项目 `.pi/skills/`；token/票据不离开服务端。受限管理会话只加载所属项目允许范围内的 Skills；SDK 按名称去重时，被全局同名技能遮蔽的授权项目副本仍会恢复加载。启动及 `/reload` 时同步所属工作区的 `relay`、`relay-runner`，使用当前安装包随 SDK 适配的模板。项目 `.pi/skills/relay/` 与 `.pi/skills/relay-runner/` 是平台保留目录，其中旧模板会更新；其他自定义 Skill 不覆盖。普通模式及完整特权管理模式保留普通 SDK 资源加载行为，不执行这项模板同步。

完整特权管理会话在启动和 `/reload` 时仅清理确认是平台原样下发的项目 Relay 副本，改由已启用的内置 Relay 包提供技能。清理只匹配当前模板或已知历史模板，且目录中必须仅有普通文件 `SKILL.md`；用户改过的内容、额外文件、符号链接及其他自定义 Skill 均保留，真实同名冲突仍会提示。取消特权后，下次创建或重载受限管理会话会按上述受限模式规则重新下发当前模板；旧特权会话不会运行中自动降权，应停止使用并通过新的授权入口进入。普通模式不执行此清理。升级此行为需重启 `pi-web-sessiond.service`，不改变现有特权授权与沙箱规则。

`workbench_search_knowledge` 只搜索授权目录中的资源名称和元数据，不搜索正文，可用 provider=ragflow/bookstack。正文关键词没有匹配资源时，应省略 `keyword` 再列出授权目录，选取返回的精确 `resourceName` 后检索正文；目录无匹配不代表正文没有内容。RAGFlow 内容用 `workbench_retrieve_knowledge`，BookStack 关键词检索用 `workbench_retrieve_bookstack`，参数 `resource_name`、简洁 `question`、可选 `resource_version=live`、`top_k` 默认 8/最大 20。通过后端 `POST /api/knowledge-access/bookstack/retrieval` 读取独立授权的已发布书籍当前非草稿页；该检索工具只读，不提供语义检索。返回纯文本、修订、更新时间、源 URL 与 `knowledge://` 引用；`truncated` 表示搜索/文本限制，不保证包含所有匹配。上限五批各 100 候选、每页 8000 字符、总 40000。源链接仍需要读者自身浏览器权限，工具不授予 BookStack 登录。

停止 `workbench_retrieve_knowledge`、`workbench_retrieve_bookstack` 或 `workbench_read_bookstack` 工具调用时，取消会传给正在进行的 HTTP 请求，取消与请求超时分别报告。在 BookStack 写请求发出前取消，PI WEB 不会发送该写请求。请求发出后若因取消、超时或断连而无法确认结果，保留原 `idempotencyKey`，用 `workbench_get_bookstack_operation` 查询回执。

签名 `projects[].agentsInstructions` 仅在项目 `AGENTS.md` 不存在时独占创建，`replace-managed` 策略为首次创建的文件保留托管标记；已有文件不因初始化自动覆盖。管理嵌入可在当前工作区的[指令确认菜单](plugins.md#managed-agents-review)中选择覆盖并备份或保留，无此字段仍兼容，普通项目不受影响。

可选签名字段 `projects[].agentsInstructionsUpdatedAt` 由平台提供模板的实际更新时间，使用带时区的 ISO 时间，如 `2026-10-26T10:00:00Z`。PI WEB 用它与当前工作区 `AGENTS.md` 修改时间比较，不从模板修订号或请求时间伪造更新时间；缺少此字段时界面显示“未提供”，不自动闪烁，仍可手动选择覆盖或保留。平台须提供此字段才能按时间提醒模板更新。时间判定、用户确认与备份规则见[管理工作区指令](plugins.md#managed-agents-review)。

<a id="bookstack-content-operations"></a>
#### BookStack 定向读取与写入

`workbench_search_knowledge` 返回每项资源的 `actions`，可取 `read`、`create`、`update`、`delete`；旧授权未提供该字段时按 `read` 处理，不自动获得写权限。BookStack 仍须是已发布、`L0`、`live` 的授权知识资源；目录中的 `L0` 不授予写权限。PI WEB 检查相应 action，再由 Workbench 后端按当前用户和指定整本书复核操作范围。

| 工具 | 参数与结果 |
| --- | --- |
| `workbench_read_bookstack` | `resource_name`、`entity_type`（`book`、`chapter`、`page`）及可选 `entity_id`；读取章节/页面时必须传 ID。返回实体 `content`、`baseVersion` 和 `actions`。 |
| `workbench_write_bookstack` | `resource_name`、`action`，按操作传 `entity_id`、`name`、`html` 或 `markdown`；`parent_chapter_id` 仅用于新增页面。修改/删除必须传 `base_version`。可传 `idempotency_key`，省略时由 PI WEB 按会话与工具调用 ID 生成稳定键，结果中回传所用键。 |
| `workbench_get_bookstack_operation` | `resource_name`，以及 `operation_id` / `idempotency_key` 二选一。只读查询本人的操作回执，返回状态、实际操作者、时间和可选核实结论；不读取正文或重放请求。 |

写入动作限 `book.update`、`book.delete`、`chapter.create/update/delete`、`page.create/update/delete`。`create` 仅在授权书内创建章节或页面；新增页面须提供非空 HTML 或 Markdown，整本书创建由工作台管理入口负责。`update`/`delete` 可作用于授权书本身及其章节、页面；`book.delete` 删除整本书，整书或整章删除会按原生规则级联删除其内容，包括子草稿。独立草稿页读/改/删以及移动页面不在此入口支持范围。工具参数不接受操作者身份，实际用户由后端 Agent Session 确定；后端负责授权与操作审计。PI WEB 不增加 AI 或人工审批步骤，已有工具 allow/deny 仍生效。

修改或删除前先定向读取目标，将返回的 `baseVersion` 原样作为 `base_version`。版本冲突后重新读取并核对内容，再决定如何修改。部署配套的 BookStack v2 补丁后，工作台修改和删除在原生事务中复核目标手册与内容版本。原生页面编辑器保存时也锁定手册并校验版本，过期提交返回冲突。写入返回 `operationId` 和 `status`（`succeeded` 或 `unknown`）；`unknown`、网络超时或服务端错误表示结果未确认，PI WEB 不自动重试，也不能换新键重发。

保留原 `idempotencyKey` 和已返回的操作编号，调用 `workbench_get_bookstack_operation` 核查。回执状态为 `pending/succeeded/unknown/failed`，可能另带 `resolution`（实际核实者、时间、依据、`applied/not_applied` 结论）；核实不会改写原执行状态。同一手册有写入待确认时，PI WEB 只用原幂等键查回执。恢复会话、更换工具调用编号或幂等键后仍按此处理。若请求改了标题或正文，工具会提示本次修改未发送，本轮也不会补发。原结果确认后，用户可在新一轮明确发起相同或修改后的操作，包括重新创建页面。各 PI WEB 会话分别保存自己的记录。手册已删除或当前授权已撤销时，有效账号仍可查本人历史回执。未结案的 `pending/unknown` 会冻结同书新写入，须由工作台平台管理员核对原生结果并结案；这是异常恢复流程，不是正常写入审批，PI WEB 工具不会替管理员解冻或重放。

定向读取、写入及回执分别调用后端 `POST /api/agent-access/bookstack/read`、`POST /api/agent-access/bookstack/operations`、`POST /api/agent-access/bookstack/operations/receipt`，把工具的 snake_case 参数转换为 camelCase；成功响应均为 HTTP `200`，执行结果以正文 `status` 区分。RAGFlow 检索和受控 MCP 的 `L0` 只读能力边界保持不变。

先协调部署匹配的 Workbench 后端与 BookStack 原生补丁，确保资源快照、knowledge token、检索、读写及回执 endpoint 可用，再更新 PI WEB；旧后端不会因升级 PI WEB 自动具备写入能力。BookStack 凭据只在后端，不新增 PI WEB BookStack 配置。工具更新需重启 `pi-web-sessiond.service`，Web/API 与 daemon 保持版本及有效配置一致；共享 endpoint/limit 改变时重启两进程。

<a id="managed-data-directory"></a>
### 托管数据目录

默认 `~/.pi-web` 保存项目/机器注册表、本地插件、默认 daemon socket、归档索引及项目认证/偏好。新目录是独立实例，没有原注册表和归档，不自动迁移。需要迁移时先停服务，复制 `archived-sessions.json` 和每条记录指向的归档内容，包括自定义目的地；仅复制默认 `archived-sessions/` 不保证完整。

一个目录只能有一个活跃 daemon。第二实例需要独立数据目录、daemon endpoint 和 Web 端口。过期所有权通常自动恢复；启动仍拒绝时，必须先确认所报进程已退出，再按错误提示处理 `sessiond-owner.json`。不要删除活跃所有权文件。

所有权标记更新使用短时互斥目录 `sessiond-owner.json.lock`，不会按年龄自动抢占。若启动/停止进程在更新期间崩溃，后续操作会明确报锁冲突；必须确认没有 daemon 正在启动或停止，才可删除该残留空目录后重试。升级这一保护机制时，先完整停止旧 daemon，再启动新版本，避免旧版本绕过互斥保护。

该变量不改变 `PI_WEB_CONFIG` 或 Pi 自有会话存储。

<a id="agent-process-environment"></a>
### 代理进程环境

普通代理 shell、终端和子会话继承 daemon 环境；移除 `NODE_ENV`、`PORT`，避免 daemon 生产设置影响开发命令。模型服务令牌 `PI_GUARDRAIL_TOKEN` 和审计写令牌 `GUARDRAIL_AUDIT_TOKEN` 保留在 daemon 内。PATH、HOME、代理变量和 `PI_WEB_*` 保留。daemon 导出已解析的 `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR`；运行时读取共享 agent 设置与会话路径，但模型认证仍遵循 owning-project registry，不能由子进程环境说明推断普通项目共享凭据。

会话启动的进程继承 `PI_WEB_SESSION=1`，表示处于现有 PI WEB 中。继承变量指向当前实例；误启动第二实例会因活跃数据目录所有权失败。刻意运行独立实例必须另设目录、endpoint 和端口。

系统提示词默认包含嵌套及 Docker 布局事实，提醒不要从需要保留的会话内重启宿主 daemon，并在受支持的开发重启中先启动 Web/API。可用 `environmentFacts: false` 或 `PI_WEB_ENVIRONMENT_FACTS=false` 禁用。管理嵌入仍使用受控工具和既定 Bubblewrap/网络/宿主权限策略，不直接继承普通模式工具权限。

<a id="external-path-access"></a>
### 外部路径访问

默认相对读取只在工作区内，绝对路径拒绝。`basePaths` 与 `pathAccess.allowedPaths` 的有效根允许浏览器文件面板和绝对 `@` 补全列出/读取指定外部根。

允许 Unix 绝对路径 `/opt/reference`、家目录相对 `~/SDKs`、Windows 宿主上的 `C:\Users\dev\SDKs`。展开 `~`，通过 `realpath` 规范化根，要求存在目录，拒绝符号链接逃逸。不支持相对根。设置保存在所选机器，网关网络设置仍在网关。

这不是普通 Pi 代理或 OS 用户的沙箱，只约束浏览器/API 外部文件暴露。

<a id="manual-upload-defaults"></a>
### 手动上传默认目录

文件面板支持多文件：直接拖放立即上传到工作区有效目录；“上传”按钮打开审核对话框，可修改目录和选项。默认 `.pi-web/uploads`，未被环境强制时，项目 `uploads.defaultFolder` 覆盖机器默认值。

目录非空且必须相对工作区；重复分隔符和反斜线规范化为 `/`，绝对路径与 `..` 逃逸拒绝。仅审核对话框允许清空目录，把该批次上传到工作区根。默认创建父目录，不覆盖已有文件；审核可显式覆盖，直接拖放从不覆盖。进度展示完成、冲突和错误。联邦使用目标机器/项目目录，大小限制由服务上传的机器控制。

<a id="prompt-attachment-defaults"></a>
<a id="prompt-attachments"></a>
### 提示词附件默认目录

附件投递“保存到…”把文件写入工作区，并在提示词中引用路径，不以内联方式附加内容。默认 `.pi-web/attachments`，项目 `attachments.defaultFolder` 覆盖机器默认值；格式/逃逸规则与上传目录一致。显式附件 API 请求目录优先于配置。联邦设置保存在目标机器，编辑器使用有效项目目录。

<a id="speech-dictation"></a>
### 语音输入

输入框的话筒把一段录音交给语音服务转写，结果插入当前草稿的光标处，不自动发送，也不产生附件或会话数据。浏览器只负责采集（MediaRecorder），daemon 负责校验并转发，因此请求发往拥有所选项目的机器。麦克风要求安全上下文：HTTPS 或 `localhost`/`127.0.0.1`；非安全来源下浏览器不提供 `navigator.mediaDevices`，此时不渲染话筒并显示说明。

```json
{
  "speech": {
    "endpoint": "http://192.168.2.162:8080",
    "api": "transcriptions",
    "model": "qwen3-asr-0.6b",
    "language": "zh",
    "apiKeyEnv": "SPEECH_API_KEY"
  }
}
```

`endpoint` 是 OpenAI 兼容服务根，缺少 `/v1` 时自动补全。`api` 选 `transcriptions`（默认；multipart 调用 `/v1/audio/transcriptions`，读取响应 `text`）或 `chat`（`/v1/chat/completions` + `audio_url` 数据 URI；正文从 `<asr_text>` 标签之后提取，语言标签丢弃）。`model` 用服务端暴露的模型名，不是仓库 id。`language` 省略即自动识别；`timeoutMs` 默认 60000、上限 300000；`maxAudioBytes` 是 base64 解码后的上限，默认 8 MiB、上限 32 MiB。

鉴权可直接设置 `speech.apiKey`，或保留示例中的 `apiKeyEnv` 环境变量方式。有效配置中的非空 `apiKey` 优先；没有直填 Key 时，daemon 从 `apiKeyEnv` 指定的环境变量读取令牌，变量未设置或为空会报错，不会把变量名当作 Key。两种方式均作为 `Authorization: Bearer` 发送；无需鉴权时同时省略这两个字段。`speech` 仅支持机器级配置，`PI_WEB_SPEECH` JSON 也接受 `apiKey`。

直填 Key 以明文保存在所选机器现有的全局配置文件中，不要写入项目配置或提交到 Git；应限制该文件及备份的访问权限。普通配置 HTTP 响应的 `config`、`effectiveConfig`、`defaultsConfig` 均移除 `apiKey`，通过可选的 `speechApiKeyPresence` 对象报告这三层是否存在直填 Key（同名布尔字段）；密钥不写入日志或审计。设置面板通过单独的 `GET /api/config/speech-api-key` 或 `GET /api/machines/:machineId/config/speech-api-key`（含 `local` 别名和远端转发）读取可写层已保存的 Key；该接口遵循网关现有的普通访问认证策略，返回 `{ "apiKey": "..." }`，未保存时为空字符串，使用 `Cache-Control: no-store`，不返回环境变量或部署默认值中的令牌。旧版 PUT 保存省略 `apiKey` 时保留已存值；显式删除使用 PATCH 的 `unset: ["/speech/apiKey"]`，只移除可写层，随后恢复继承的部署默认 Key；若没有继承的直填 Key，才使用环境变量方式。

未配置 `endpoint` 视为关闭：daemon 的运行时能力报告不含 `prompt.speechRecognition`，浏览器不渲染话筒。该判断发生在 daemon 启动时，修改后须重启 daemon；Web/API 与 daemon 必须使用同一份有效配置。录音容器（WebM/Opus、Ogg/Opus、MP4/AAC）直接上传，不做浏览器转码。

设置 → **语音输入** 编辑所选机器的 `endpoint`、`api`、`model`、`language`、`apiKey` 与 `apiKeyEnv`。存在可写层已保存 Key 时，面板单独加载并回填密码输入框，默认以掩码显示，不写入 `localStorage`；切换机器或关闭面板后的迟到响应不会回填。未修改的 Key 不随其他设置重复保存，填写新值会替换，主动清空输入框或使用清除操作后保存会移除可写层的 Key；没有编辑过的空草稿仍保留已存值。其他已保存字段清空时也会显式 unset。被环境强制的字段显示锁定与来源，保存只写入改动过的叶，不删除被环境策略遮蔽的已存覆盖。`timeoutMs` 与 `maxAudioBytes` 仍只通过配置文件或环境设置。面板保存后提示重启该机器的 daemon，浏览器在下次读取运行时状态时决定是否显示话筒。

<a id="agent-state-directory"></a>
<a id="agent-runtime"></a>
<a id="pi-compatible-agent-profile-and-companion-cli"></a>
### Pi 状态目录与本地兼容输入

会话复用已安装的 Pi npm SDK。`PI_WEB_PI_PACKAGE_DIR` 显式选择 SDK 包根目录，优先于普通 npm 解析与 PATH 中第一个 `pi`；无 SDK 包的独立二进制不受支持。显式路径无效时直接失败，不回退另一份 Pi。`/pi-web` 将宿主安装传给 CLI，新安装的原生服务保留这个选择；更改后须重装服务定义并重启 Web 与 daemon。doctor 和状态仍分别核对有效安装与 companion CLI，不能把 PATH 上可执行命令当作 SDK 已对齐的证据。

标准 `PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）选择共享 agent 设置、包与默认会话路径；`PI_CODING_AGENT_SESSION_DIR` 可独立指定会话路径。这些变量与 SDK 安装目录不同，不新增配置文件键。

```sh
PI_CODING_AGENT_DIR=/opt/pi-profiles/lab
PI_CODING_AGENT_SESSION_DIR=/opt/pi-profiles/lab-sessions
```

目录必须符合所选 SDK 数据布局；不转换不兼容格式，不迁移 profile，也不移动 PI WEB 归档。

daemon 启动时解析并固定目录，终端、bash、子会话使用相同值。运行期间改变环境不生效；包管理、插件发现、状态/安装识别和更新计划仍使用 daemon 的有效目录。Web 重启恢复同一有效目录，不独立解析新值。daemon 无法报告有效目录时，相关操作不可用，不自行回退。仅有效目录和可执行 companion CLI 都具备时提供包管理更新命令，并固定目录。

本地保留旧 `agent.command`/`agent.dir`、`PI_WEB_AGENT_COMMAND`/`PI_WEB_AGENT_DIR`/`PI_WEB_AGENT_SESSION_DIR` 和 Windows command/sessionDirEnvKeys 扩展，用于已有内部配置与 companion 行为；不扩展或拒绝上游两字段公开 v2 profile，不自动重写用户配置。弃用输入通过诊断提示，迁移请使用标准 Pi 环境变量；改变内部有效目录或命令仍需重启 daemon。

<a id="pi-extension-provider-baseline"></a>
### Pi 扩展提供器基线

普通模式提供器归属于注册项目的 `ProjectAuthService` 模型 registry，而不是全机共享；同项目工作区共享，其他项目和管理模式隔离。基线由 Pi 内置提供器、环境凭据、该项目托管 `models.json` 及全局 Pi 扩展/包建立；首次项目文件复制规则见[配置文件](#config-files)。PI WEB 工作区插件是另一概念。

连接设置在对应运行时基线建立后固定。项目扩展和 `/reload` 不能新增、替换或删除提供器；扩展其他功能正常加载与刷新。全局提供器定义、凭据/连接配置或实现变化需要手动重启 daemon，Web 重启和 `/reload` 不重建基线。

虚拟模型的 router 捕获会话上下文，不能存入同项目工作区共享的 registry。PI WEB 在全局扩展 bootstrap 前即拒绝 `registerVirtualModel`/`unregisterVirtualModel`，后续会话中也不能重新注册；使用物理模型。诊断不包含模型定义或 ID。

已知提供器仅模型列表变化、其他设置保持不变时可立即接受刷新，无需重启。更新按精确 registry 身份应用，只影响 owning project；同项目两个工作区注册不同列表时后注册者生效，不影响别的项目。模型条目可带 `baseUrl`/`headers`，覆盖该模型的提供器值；扩展仍是可信进程内代码，不是安全沙箱。

daemon 日志记录忽略的配置变更与模型列表应用，不输出提供器配置或凭据，不生成浏览器通知。管理 registry 独立；不能为对齐上游全局刷新而恢复跨项目共享。

<a id="background-model-catalog-refresh"></a>
<a id="catalog-refresh"></a>
### 后台模型目录刷新

目录网络刷新由 daemon 后台调度，请求自身不发起目录抓取，慢提供器不单独阻塞模型选择、启动或认证对话框。已在途刷新可能短暂影响对应 runtime 状态读取；会话活动行说明启动步骤及并发目录刷新，这是并发提示，不断言因果。

- daemon 启动 **15 秒**后首次运行，随后**每小时**检查。Pi 已保存目录四小时内视为新鲜，多数检查不联网。
- 登录/注销后按精确项目 registry 立即刷新，绕过新鲜度；管理 registry 独立。
- 每次最多 **60 秒**，超时/不可达五分钟后**只重试一次**；HTTP 错误留到下次计划。
- 失败不清空目录，保留最后成功结果并记日志；daemon 关闭会中止在途刷新。
- 下次请求模型列表才见新目录，已打开选择器可需重新打开。
- 设置 daemon 环境 `PI_WEB_OFFLINE=true` 或 `PI_OFFLINE=true` 后重启，完全禁止目录联网，包括登录后刷新；读取对应存储已有目录。
- `PI_WEB_SKIP_VERSION_CHECK`/`PI_SKIP_VERSION_CHECK` 只抑制版本检查，不禁止目录刷新。离线/跳过标记只接受 `true`/`false`（大小写不敏感）或 `1`/`0`；空值或其他值导致启动失败。任一离线标记为真即禁止目录刷新；恢复时将相关标记设为假或移除。

<a id="project-trust-for-project-local-resources"></a>
### 项目信任

普通模式每次启动都先遵循 Pi 项目信任，再加载 `.pi/extensions/*`、`.pi/settings.json` 的包及其他项目资源，不能用配置关闭信任门槛。已有 `respectProjectTrust` 已移除，配置保存时移除该废弃键；读取不改写文件，也不会自动把已有项目设为可信。

优先级与 Pi 无交互提示时一致：没有需要信任资源则正常加载；全局扩展 `project_trust` 决定优先，可请求 `remember` 写入 agent `trust.json`；否则已保存决定优先；最后 `defaultProjectTrust` 的 `always` 加载，`never`/`ask` 跳过（没有浏览器运行时信任弹窗）。

添加项目可显式勾选“信任此项目”，不操作不写决定；普通文件夹项目可在项目的“⋯”菜单切换“已信任”，提供器工作区在工作区菜单切换。服务器解析授权工作区路径，远端保存于远端。下次运行时创建/打开读决定，既有运行时不立即重新加载，`/reload` 保留运行时信任状态。项目 auth/model/preferences 存储不迁入 trust；管理嵌入不读取/写入普通信任 API，继续独立授权资源与沙箱。

<a id="session-daemon-tools"></a>
<a id="session-tools"></a>
### 会话守护进程工具

`spawnSessions` 默认 `true`，提供 `spawn_session`，在同一项目工作区创建独立会话，不自动返回结果或授予管理权限。`subsessions` 默认 `true`，同时要求 `spawnSessions`，提供 `spawn_subsession`、`list_subsessions`、`check_subsession`、`read_subsession`、`yield_to_subsessions`、`manage_subsession`。跟踪子会话固定父 cwd，`spawn_subsession` 不接受 `cwd`；其他工作区使用独立会话。

跟踪子会话运行结束只向父会话发送 idle/error 通知，不自动交付最终答案，也不证明任务完成。忙碌父会话在下个安全边界收到通知；父会话可继续工作，或用 `yield_to_subsessions` 等待新通知。已收到的通知不自动重复，详细状态和输出通过 check/read 显式检查。

`manage_subsession` 仅控制直接子会话：`stop` 中断当前运行，`resume` 继续空闲会话，`archive` 归档空闲子会话。可选 `prompt` 只用于 resume；忙碌子会话须先 stop 再归档。停止不冻结进程或撤销已完成写入，不授予控制无关会话或孙会话的权限。

`sessionMessages` 默认 `true`，独立于 spawn 开关，提供 `send_session_message`；设置为 `false` 或 `PI_WEB_SESSION_MESSAGES=0` 并重启 daemon 后移除工具及投递能力。目标必须是同机器、同注册项目中的精确已知会话 ID；可跨工作区，不能发送到归档会话。空闲目标启动新运行，忙碌目标在安全代理边界收到 steering，不中断执行中的工具，压缩或独立 shell 结束后再投递。接受不代表已读或得到回答；队列不是耐久邮箱，停止或关闭会话可能丢弃待处理消息。发送不创建父子关系、检查/控制权限或结果订阅。运行时提供发送者 ID，子会话还获得父 ID，但身份不强制协作流程或额外权限。普通、受限管理与完整特权管理运行时均可提供该工具；管理目标必须属于相同管理作用域，受限模式仍遵守管理工具授权；目标解析拒绝跨普通/管理边界通信。

两种 spawn 支持精确 `provider/model-id`；省略模型继承父模型，思考级别继承并限制到目标模型能力。`#provider/model-id` 引用不自动改变当前会话。

#### 人工介入

代理先在对话中写明问题，再调用 `request_human_intervention`（简短 `reason`）标记“需要输入”并结束当前运行。此工具不受 spawn、消息或问题表单开关控制，也用于审批或 PI WEB 之外的操作；仅写问题文本不设置指示器。静态空心环汇总到工作区、项目和机器，含折叠子会话组；未读状态独立。

任何新代理运行都会清除代理请求的介入状态；只排队消息、阅读会话或浏览历史不会清除。仍需帮助时应重新请求。该状态随会话持久化并跨 daemon 重启保留，不是分支专属表单。新 `ask_user` 表单自动设置相同状态；待答扩展对话框也显示“需要输入”，但保留独立取消/超时生命周期，运行时对话框不跨 daemon 重启恢复。升级后重启 daemon 激活工具及跟踪。

#### 问题表单

`askUser` 默认 `true`，在 **设置 → 会话守护进程** 切换。表单支持 1–20 问，每问最多 12 选项、可选多选及自定义文本，可跳过。表单随对话持久化并跨重启保留，只有活动对话末尾表单开放；回答、跳过或发送消息关闭它，旧表单仍可展开只读查看。历史树回到该问题会重新开放，归档对话只读。修改开关或升级实现需重启 daemon。管理子会话仍保留原管理上下文及显式工具拒绝。

<a id="extension-dialogs"></a>
### 扩展对话框

扩展 `ctx.ui.confirm()`/`select()`/`input()` 以内联卡片显示，包括会话启动和运行中工具钩子。支持始终启用，无单独开关；回答走 daemon 独立通道，不经过提示词队列。详见[插件说明](https://pi-web.dev/plugins#pi-extension-dialogs)。

`extensionDialogsTimeoutMs` 默认 `300000`（五分钟），`0` 无限等待，与扩展自己的 timeout 取较早期限。取消值为确认 `false`，选择/输入 `undefined`。全局配置编辑后重启 daemon。

<a id="pi-web-plugin-config-and-recovery"></a>
<a id="plugin-config"></a>
### 插件配置与恢复

`plugins` 控制纯浏览器、纯服务端与双入口的期望启用状态和 JSON 设置，不管理 Pi 包安装。默认启用，包可声明 `defaultEnabled: false`；显式配置覆盖包默认。必需 `pi-web.terminal` 普通启动不能禁用，设置中不可编辑。服务端设置启动时生效，诊断不暴露设置值。

```json
{
  "plugins": {
    "git": { "enabled": true, "settings": {} },
    "workspace-tasks": { "enabled": true },
    "updates": { "enabled": false }
  }
}
```

保存或换包改变期望状态，不替换运行代码。`npm run dev:web` 默认启用进程级 `PI_WEB_DEV_PLUGIN_PAIRING=1`，仅开发启动允许刷新后的 UI 连接仍运行的旧后端；设置为 `0` 恢复严格配对。生产默认严格，后端变化仍需手动重启 daemon。禁用服务端插件及配套 UI 可在重启前仍运行；包/设置不匹配、健康或兼容异常时暂缓配套 UI。设置区分期望与实际状态，daemon 不可用时实际状态不可用。混合版本不支持，远端插件/Git 可不可用或 404；网关/目标一起升级，重启更新的 Web/API 与目标 daemon 后刷新。不能回退到网关。

顺序：安装/更新目标包 → 保存期望配置 → 纯浏览器刷新；服务端则手动重启目标 daemon、等就绪、再刷新。重启可能中断活跃会话和所有权。仅浏览器刷新、Web/UI 自动重载、Web/API 重启、Pi `/reload` 都不激活服务端变化。

恢复 CLI 离线编辑全局配置，不连接 daemon、不发现/导入包、不带机器凭据；直接在目标机器运行，自定义配置加 `--config /path/to/config.json`：

```bash
pi-web plugins disable <plugin-id> --restart
pi-web plugins safe-start show
pi-web plugins safe-start set bundled-only --restart
pi-web plugins safe-start set none --restart
pi-web plugins safe-start clear --restart
```

`disable` 保存 `enabled: false`，但拒绝必需终端。`bundled-only` 在发现/导入之前过滤外部插件，仍要求终端；`none` 跳过全部服务端插件，保留内核项目目录与诊断/设置，无终端工作流。`clear` 下次恢复普通发现。不支持的 safeStart 形状/值按 `none` 失败关闭，通过 show/set/clear 修复。

`--restart` 只执行识别的安全安装计划，否则打印手动指引。先持久化再重启，服务管理器失败后手动重启。一般失败尽可能隔离，但插件共享 daemon event loop，不是真正崩溃隔离；bundled-only 绕过外部失败，none 连内置失败也绕过，改变后仍需重启。

<a id="keyboard-shortcuts"></a>
<a id="shortcut-config"></a>
### 快捷键

`shortcuts.<actionId>` 值如 `mod+k`、`g p`、`shift+enter`，`null` 禁用该动作。

```json
{
  "shortcuts": {
    "core:view.chat": "mod+1",
    "core:session.stop": null,
    "app.navigation.focus-projects": "g p",
    "composer.send.desktop": "mod+enter",
    "composer.send.mobile": "shift+enter"
  }
}
```

从 **设置 → 键盘** 编辑、录制、禁用或重置。`mod` 为 Ctrl/⌘，浏览器/系统可占用组合。应用支持单键和序列；无修饰键及仅 Shift 的绑定不在 input/textarea/select/contenteditable 内开始。序列 1.2 秒到期，Escape/焦点变化取消；自定义优先，同优先级按 action ID；短绑定遮蔽同前缀长序列。

编辑器发送绑定只接受一个组合。宽度 >760px 默认 Enter；宽度 ≤760px 默认 Shift+Enter，键仍为 `composer.send.mobile`，不因宽屏触控或粗指针改用窄屏规则。未分配 Enter/Shift+Enter 插入换行；普通 Enter 优先接受选中补全。编辑器内发送绑定优先于应用快捷键，空草稿或不可发送时也如此。`null` 禁用键盘提交，不禁用按钮。

对应绑定未配置前保留浏览器旧 Enter 偏好，重置回该回退；不把旧偏好自动复制到共享配置。触屏键盘自动首字母大写不视为 Shift。

<a id="prompt-completions"></a>
## 提示词补全

- 草稿开头 `/` 补全会话命令。参数提示显示在名称旁，选择后一次性灰色提示在下次编辑/移动光标时消失。
- `@` 补全已跟踪文件；`@ `（at 后空格）或 `!@` 补全全部文件。选择插入路径引用，含空格自动加引号。
- `#` 补全当前会话可用模型，不区分大小写，最多 12 项。选择插入 `#provider/model-id`，指引代理使用模型，例如 spawn 的 model 参数。

<a id="completion-tools"></a>
<a id="optional-completion-tools"></a>
## 补全工具

可在服务器 PATH 安装 `fzf` 改善文件补全排序；不安装也能补全，`rg` 用于文件发现。
