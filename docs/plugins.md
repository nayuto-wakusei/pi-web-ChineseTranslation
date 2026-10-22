# 插件与 Pi 包

使用工作区工具、快捷操作和集成定制 PI WEB。可以安装现成的包，也可以让代理为具体工作流创建插件，无需修改 PI WEB 本身。

本指南说明可实现的功能和使用方式；实现时请查阅[公开契约与示例](#agent-development)，不要把本页作为第二份 API 声明。

## 内置中文语言插件

`zh-cn` 随包提供且默认启用；在机器配置设置 `plugins["zh-cn"].enabled: false` 后恢复英文，无需额外语言文件。刷新网页、下次启动 CLI、重启服务后生效，详见[配置参考](config.md#chinese-language-plugin)。浏览器使用网关的语言，远端提示保持远端语言。

浏览器插件可通过激活上下文的可选 `translate(key, englishFallback, params)` 使用稳定消息键和命名参数；未提供翻译器或词条缺失时使用英文。语言插件以 `localizations` 贡献纯文本词典，不扫描 DOM 或注入 HTML。服务端激活上下文也可提供 `translate`，按所属机器配置格式化自有提示。旧插件 API 仍兼容；不要翻译用户输入、模型回复或代理转发的远端响应。Node 端只读取随包的 JSON 词典，不执行浏览器入口。

浏览器插件需要显式声明翻译类型时，可从公开入口 `@chainingintention/pi-web-cn/plugin-api` 使用 `import type` 导入 `Translator`、`TranslationParameters`、`TranslationMessages` 和 `LocalizationContribution`；服务端入口 `@chainingintention/pi-web-cn/server-plugin-api` 导出前两项。通过上下文调用翻译器，不要导入宿主内部的 `createTranslator` 或私有 `dist/` 路径。上下文的 `translate` 保持可选，兼容未提供该能力的旧宿主。

<a id="what-can-be-built"></a>
## 可实现的功能

| 目标 | 插件功能 |
| --- | --- |
| 展示项目健康状态、服务链接、环境信息 | 工作区标签与面板 |
| 添加仪表盘、文件查看器或项目工具 | 工作区面板、文件帮助方法与浏览器 UI |
| 方便查找常用操作 | 操作面板命令与快捷键 |
| 运行构建、测试或开发服务器 | 工作区终端命令 |
| 定制外观 | 主题及明暗主题组合 |
| 在聊天和文件中预览图表、文本格式 | 浏览器内容渲染器 |
| 读取或修改工作区文件 | 列出、读取、写入、移动、删除及上传文件 |
| 显示后端实时结果 | 浏览器入口与服务端入口之间的请求或流式通道 |
| 保存插件自己的结果和偏好 | 持久化服务端插件目录 |
| 发起 Pi 对话或与 Pi 扩展协作 | 宿主会话能力与会话内消息 |
| 使用其他系统替代 Git 工作区发现 | 工作区提供器 |

面板可支持直达链接和浏览器历史，并在文件变化或代理工作完成后刷新。文件和终端帮助方法始终针对面板所属机器与工作区，包括远端机器。

例如，可以请求代理创建“运行项目检查并显示结果的面板”“链接工作区预览部署的徽标”或“启动审查会话并保存结论的工具”。

<a id="pi-packages-extensions-and-plugins"></a>
## Pi 包、扩展与插件

- **Pi 包**是可安装的分发包，可以包含扩展、技能、提示词模板、主题和 PI WEB 插件。
- **Pi 扩展**定制代理的工具、命令、钩子、模型提供器及会话行为。
- **PI WEB 插件**定制 Web 应用及工作区集成。

一个包可包含上述三种定制。安装包与启用 PI WEB 插件是独立操作；禁用插件不会移除包里的 Pi 扩展、技能或提示词。

代理行为放在 Pi 扩展中，Web UI 放在 PI WEB 插件中。需要两者协作时一起发布，通过已托管会话的连接通信。

<a id="how-plugins-work"></a>
## 插件如何运行

包可以声明浏览器入口、服务端入口或双入口：

- **浏览器入口**贡献操作、面板、标签、主题与内容渲染器，使用宿主帮助方法访问文件、终端及提示词编辑器。
- **服务端入口**运行在会话守护进程中，可为浏览器入口服务、存储插件数据、使用宿主能力或提供工作区。
- **包内对等入口**连接同一插件的浏览器与服务端。宿主解析机器和工作区；插件不必拥有该工作区才能为其服务。
- **能力**声明所需的宿主或插件功能。启动前必须满足指定版本的依赖。

在 `activate()` 中声明贡献，在 `start()` 中初始化依赖支持的工作，在 `dispose()` 中释放资源。长时间工作遵循 `lifetimeSignal`。简单浏览器插件仅需返回贡献。

<a id="scoped-discovery-and-backend"></a>
### 作用域发现与后端

浏览器 API v5 的 `catalog` 固定到创建上下文时的机器，只读查询公开项目、工作区和会话投影，不返回 transcript 或内部会话路径。切换选择不会改变已保留 catalog 的目标；会话使用完整、区分大小写的精确 ID，不接受缩写。

可选 `backend` 指向同包配对的实际服务端入口：`backend.forScope({ kind: "machine" })`、`{ kind: "project", projectId }` 或 `{ kind: "workspace", projectId, workspaceId }` 返回请求/通道 peer。没有 session backend scope。宿主重新解析 authority，插件不传可信 cwd；机器与后端 revision 不匹配时拒绝，不静默使用网关同名后端。操作是否支持取决于实际 peer/capability，不由 API 版本单独保证。旧浏览器 v4 与服务端 v3 继续使用其原契约。

服务端可声明 `PI_WEB_HOST_CATALOG_CAPABILITY` 获取目标宿主的公开 catalog；Pi 配套扩展通过公开服务端入口的 `createCompanionBackend(pi.events, pluginId)` 发现本地配对 backend，要求在 PI WEB 已托管事件总线上运行。普通宿主会话连接不开放管理会话，完整特权也不取消该边界。普通 catalog 排除当前配置的管理 root；它不替历史文件补写耐久 scope，曾更换管理 root 的遗留文件需人工隔离。

<a id="styles-highlighting-and-display"></a>
### 样式、高亮与显示文本

v5 `stylesheets` 贡献包含 `id`、HTTP(S) `url` 和可选 `order`（默认 `1000`，较小先加载，同序按限定贡献 ID）。使用模块相对 URL 生成 CSS 文件地址，文件内资产相对 CSS 地址解析；不支持内联 CSS 或运行时 `@import`。v5 主题使用样式表；需要共享样式的组件使用公开 `StylesheetIntegrationCapabilityV1` 注册 shadow root 或创建 Lit lifecycle controller，并在断开时释放。主题属于网关应用，浏览器设备偏好优先于网关默认值。

v5 `syntaxHighlighters` 返回有序、不重叠的 UTF-16 范围 token，不返回 HTML；宿主负责安全显示，插件遵守输入 `signal`。v5 内容渲染器还可提供 `title`、同步 `supports(request)`，并接收机器、语言和文件路径提示；正文仍是不可信输入，净化与清理要求不变。精确签名以公开声明为准。

宿主 Markdown 变换只对完成文本产生浏览器 `displayText`，部分流式文本完成后才应用。不修改 canonical 消息、持久化历史、模型输入、审计原文或消息实际 `thinkingLevel`；复制和消息操作不能把派生显示误当原文。

### 应用级面板与选择

`applicationPanels` 与 `workspacePanels` 由同一个浏览器工具区域装配。前者依附当前机器，无需先选项目、工作区或会话；后者需要已选工作区。应用级面板获得当前机器与公开选择快照，`workspace` 和工作区终端按可用性提供。内置 Info 使用应用级面板；无工作区时仍可显示机器和 PI WEB 状态。

激活上下文的可选 `selection` 服务由宿主持有。`getSnapshot()` 返回独立的基本选择快照；`subscribe()` 在选择改变后通知，不做首次回调，面板关闭后仍可订阅。返回的取消函数可提前结束订阅，插件生命周期结束时统一清理。快照不包含内部会话文件路径、消息正文或整份应用状态。

操作、应用级面板和工作区上下文的可选 `projects` 服务只读查询创建上下文时的机器：`listProjects()` 返回注册项目，`suggestDirectories(query)` 返回目录建议。保留的服务不会随之后的机器选择漂移；远端错误不会改查网关本机。旧宿主可能不提供这些可选服务。

### 提示上下文 chip

`prompt.setChip({ id, label, text, onRemove? })` 将插件上下文暂存在该上下文捕获的机器和会话，作用域同时包含会话工作目录，不同工作区的同名会话不共享 chip；要求创建上下文时已有可用、非归档的会话。相同插件内的相同 `id` 替换内容与回调；`prompt.removeChip(id)` 可静默撤回。方法在旧宿主上可能不存在，不应从渲染回调中修改 chip。

chip 由浏览器宿主持有，不是持久化会话数据；关闭面板、切换会话后仍保留各自内容，刷新页面后清除。发送时正文以空行分隔附加到消息，带 chip 的输入作为普通提示词而非斜杠或 shell 命令提交。只有服务端接受后才消费本次提交的版本，失败时保留以便重试，不删除发送期间的替换内容。用户移除和成功提交分别通知 `onRemove("user")` 与 `onRemove("submitted")`；程序撤回不通知。

### 从聊天打开工作区文件

聊天 Markdown 中的相对文件链接（包括 `./file`）和会话工作区内的绝对路径会在内置文件面板中打开。修饰键、新标签页点击或没有面板接受链接时仍使用下载 URL。文件访问仍经过服务端工作区包含检查。

工作区面板通过同步 `fileOpenQuery(context, path)` 选择是否接受链接。上下文属于该贡献，路径是解码后的工作区相对路径；返回如 `{ file: path }` 的导航查询，或返回 `undefined` 拒绝。钩子不能产生副作用。宿主按面板 `order`、标题顺序打开当前机器上第一个可见、启用且接受链接的面板，通过普通导航设置命名空间查询。面板从 `context.navigation.query` 读取选择，不需要依赖文件插件。

### 面板与标签导航

URL 的 `view` 选择响应式面板：`navigation`、`chat` 或 `workspace`。独立的 `tool` 参数按贡献 ID 选择工作区标签。打开工具设置 `view=workspace` 和对应 `tool`；切换聊天保留工具选择。`view` 不接受贡献 ID。浏览器插件用 `selectMainView("workspace")` 显示工作区但不改变标签，或用 `selectWorkspaceTool(panelId)` 选择并显示工具。

无效值留在 URL 中，不自动重定向。无效 `view` 显示警告，移动布局展示导航；双列布局保留导航，并展示有效请求工具，否则展示聊天；桌面保留常规列。有效工作区视图配无效工具时显示标签不可用，不选择其他标签，也不重复警告。省略参数使用默认值，不是错误。

操作与工作区面板上下文提供完整目的地导航 `navigate(destination): Promise<void>`：

```ts
await context.navigate({
  machineId: context.machine.id,
  projectId: context.workspace.projectId,
  workspaceId: context.workspace.id,
  sessionId: sourceSessionId,
  view: "chat",
});
```

所有字段都可省略：`machineId`、`projectId`、`workspaceId`、`sessionId`、`view` 及完整贡献 ID 的 `tool`。省略机器意味着调用时选中的机器。这不是路由补丁：省略字段使用宿主普通恢复默认值，不复制当前会话、工具或贡献查询；默认值可以恢复记忆中的会话。打开已知会话时提供项目和工作区作用域。宿主不会遍历查找 ID，也不会创建不存在的目的地。

Promise 在恢复完成时结束，也可在被较新导航取代时正常结束。缺失或不可用的目的地使用普通宿主 UI，不再额外拒绝 Promise。参数类型错误或无效 `view` 会在改变 URL/UI 前以 `TypeError` 拒绝。Captain's Log 用此接口打开结果记录的源会话。

### 聊天与文件内容预览

浏览器插件可贡献 `contentRenderers`：`id`、Markdown 围栏标签 `languages`、不含点的 `fileExtensions`，以及同步返回 Lit 模板的 `render(input)`。选择器不区分大小写，语言或扩展名任一匹配即可。`renderMode?: 'manual' | 'automatic'` 默认 `manual`：先显示源码与“渲染”按钮，不调用渲染器。这是初始策略，不限制用户显式预览；无关正文更新不重启已激活预览。作者可选择 `automatic`，并负责高效激活与异步工作。

同一渲染器用于聊天围栏、文件 Markdown 围栏和独立文本文件，遵循有效机器的插件可用性及便携/机器专属优先级。多个匹配项提供选择器，同时仅挂载选中项。默认按来源插件 ID（不是远端运行时前缀）、局部贡献 ID 的大小写敏感、与区域设置无关的码元顺序排序。标签同时标明插件与贡献；没有插件排序字段或排序 UI。

聊天按代码块在当前浏览器标签页记忆显式渲染器与“源码/预览”选择：从最后一次显式选择起 **15 分钟**，最多 **128** 个最近选择块。作用域包含机器、会话、消息/entry、part、块和精确源码。查看或重新挂载不延长期限；到期在再次访问时生效，不撤掉正在显示的预览。源码变化或选中渲染器不可用会失效该选择并恢复确定性默认策略。自动渲染不产生显式记忆；DOM 不缓存，重新挂载重新渲染。刷新或关闭标签页清除记忆。文件 Markdown 不使用聊天记忆。

独立文件仅在没有浏览器本地“源码/预览”偏好时采用插件初始策略。已保存“预览”授权所有文件渲染，包括 Markdown 中的手动渲染器；已保存“源码”禁止预览。Markdown 预览内仍可逐块选择源码或渲染器，URL 模式优先。默认策略不会自动保存为用户选择，内置文件预览保留原默认行为。

聊天图表块保留“源码”“预览”“复制源码”工具栏；独立文件在“下载”旁使用文件头部的“源码/预览”控件，遵循文件模式偏好。Markdown 文件图表保留逐块控件。未闭合围栏保持可复制源码；闭合围栏可在消息结束前预览。追加正文不重启未变的闭合块；失败回退源码；未知格式保持普通代码显示。

`input` 包含 `text`、中止 `signal`、`fail(error)`。同步渲染，组件自己管理异步工作，在断开连接或中止时清理，通过 `fail` 报告异步错误；过期错误被忽略。文本不可信：转义/净化输出，不执行源码，不放宽 Markdown 策略。宿主跳过截断输入及超过 **100,000 UTF-16 码元**的块，文件还保留内联字节大小限制。聊天与文件 Markdown 保留各自的净化器。

文件等消费者在 `requires` 声明 `{ pluginId: "pi-web", id: "content-rendering", version: 1, parse }`，在 `start` 中解析。公开 `ContentRenderingCapability` 描述 `listRenderers(request)`、`renderText(request)` 和 `renderMarkdown({ machineId, text, truncated?, toSafeHtml, allowManualPreview? })`。`listRenderers` 返回排序后的 `{ id, label, renderMode }`，不调用渲染器。

只有 `controls: "external"` 的 `renderText` 接受可选 `rendererId`，缺失或不可用时选择首个匹配项。内嵌控件拥有选择，忽略外部 ID。消费者自己提供选择器、模式切换与源码访问（如文件头部）时使用外部控件，否则使用内嵌控件。外部“源码”控件必须移除预览。

消费者管理用户意图，可用 `allowManualPreview: true` 显式授权手动预览；Markdown 授权符合条件的围栏，但不覆盖逐块“源码”选择。省略或 `false` 保留渲染器默认策略及自动预览；聊天不传此覆盖。公开能力不存用户意图，聊天有界记忆是宿主私有策略。Markdown 请求不带文件路径或语言选择器，语言来自围栏。创建 `renderText` 模板不调用渲染器。每个 Markdown 图表独立选择；切换渲染器中止旧预览并清除错误。`renderMarkdown` 必须使用消费者可信净化器，不允许插入不可信 HTML。参见[文件消费者](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/pi-web-plugins/files/pi-web-plugin.ts)和 [Mermaid 贡献](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/pi-web-plugins/mermaid)。

### 会话与配套扩展

服务端插件可创建普通、可见的 Pi 会话，可带初始提示词，也可不带。配套 Pi 扩展可与后端交换消息，使用 Pi API 执行代理工作。

**会话一旦发布就属于用户。** 初始任务完成、浏览器关闭或发起插件销毁，都不会丢弃会话或停止用户后续工作；用户可以继续对话。

消息连接只针对该机器已托管的会话，不自动打开已保存会话。发送成功不能证明配套扩展已安装或工作成功，集成必须自己报告进度与结果。连接不重放启动消息；关闭连接不停止代理。

### 存储与后台工作

服务端插件获得独立于安装代码的持久化 `dataDirectory`，同一机器上该插件的各项目共享该目录。插件自己负责格式、迁移与清理，宿主不提供另一套存储 API。

请求和通道有界，可能失败、超时或断开。发送成功不保证送达，宿主不自动重试不确定工作。长任务应自行持久化状态，让 UI 重连时不重复启动任务。

### 工作区提供器

提供器决定项目包含哪些工作区。主提供器可对它声明的项目替代内置 Git；Git 为后备，没有提供器认领时项目目录仍可作为工作区。

声明冲突会明确报错；认领后失败不会静默把所有权交给另一提供器。提供器也可声明工作区删除能力，删除作为可见终端操作运行。

工作区发现必须在宿主会话服务启动前就绪。包同时需要提供器和会话功能时，在同一个包中声明两个插件入口，无需拆分分发包。

<a id="install-and-manage"></a>
## 安装与管理

在 **设置 → Pi 包** 安装、更新、移除 npm、git/URL 或本地来源的包；在 **设置 → PI WEB 插件** 启用/禁用集成，查看是否激活、是否需要重启。

可在[社区插件目录](https://pi-web.dev/community-plugins)搜索 npm 上的包，再复制 `npm:package-name` 到目标机器安装。目录由静态网页直接查询 npm，不是 PI WEB 服务端 catalog，也不会自动安装。社区包未经审查或背书，只安装可信作者的包；更多发布约定见目录的[分享插件](https://pi-web.dev/community-plugins#publish)。

| 变更 | 后续操作 |
| --- | --- |
| 安装或编辑纯浏览器插件 | 刷新浏览器 |
| 安装、更新、配置、启用、禁用服务端插件 | 重启目标机器会话守护进程，再刷新浏览器 |
| 改变普通 Pi 扩展、技能或提示词 | 在每个空闲会话执行 `/reload` |
| 改变注册模型提供器的扩展 | 遵循[提供器重启规则](https://pi-web.dev/config#pi-extension-provider-baseline) |

**重启会话守护进程可能中断活跃会话和终端。** 先检查活跃工作，从它托管的会话之外重启。原生 systemd 用户服务：

```sh
systemctl --user restart pi-web-sessiond
```

浏览器刷新、Web/API 重启或 Pi `/reload` 不激活服务端插件变更。重启前“期望”与“实际”状态可能不同；浏览器入口与实际服务端不匹配时会暂缓提供，不运行不兼容代码。

多数插件默认启用，包可以默认关闭，设置可以覆盖。插件配置保存在普通 [PI WEB 配置](https://pi-web.dev/config)，不是安装文件里。

### 本地开发

代理可在任意目录开发包，再链接到本地插件目录：

```sh
mkdir -p ~/.pi-web/plugins
ln -s /path/to/plugin-folder ~/.pi-web/plugins/my-plugin
```

设置 `PI_WEB_DATA_DIR` 时改用 `$PI_WEB_DATA_DIR/plugins`。无需重建 PI WEB，但包必须包含编译后的 JavaScript；宿主不编译任意已安装插件源码。

<a id="remote-machines"></a>
## 远端机器

安装与设置针对设置中选中的机器。远端服务端代码运行在远端，浏览器界面经网关显示。文件、终端、对等帮助方法保留机器作用域。机器专属插件使用该机器自身安装；便携的纯浏览器插件可复用网关副本。主题属于整个应用，远端主题贡献忽略。

此 API 迁移期间网关与目标一起升级，重启更新后的 Web/API 与相关会话守护进程，再刷新浏览器。混合版本会使远端插件（包括 Git）不可用，宿主不静默替换为网关后端。

<a id="included-tools-and-optional-packages"></a>
## 内置工具与可选包

- **终端**提供终端和命令运行，是普通启动的必需插件，仅紧急安全启动可跳过。
- **文件**提供文件浏览、预览、上传；禁用面板不移除其他插件的文件帮助方法。
- **Git**发现工作区并显示状态/差异；禁用后保留项目目录工作区，除非其他提供器认领。
- **Mermaid**默认手动模式，点击“渲染”预览 `mermaid` 围栏和 `.mmd`/`.mermaid` 文件。内置引擎在不透明来源、网络受阻的沙箱中本地运行，不发送源码给图表服务。交互链接和外部资源不可用。禁用后保持代码显示；纯浏览器插件只需刷新页面。
- **信息**作为应用级面板显示 PI WEB 状态与可复制诊断，无需先选择工作区。
- **更新**在需要时显示更新/重启建议，并提供手动检查。
- **工作区任务**将项目命令显示为可运行操作。

### 工作区任务

在项目创建 `.pi-web/tasks.json`：

```json
{
  "version": 1,
  "tasks": [
    { "id": "app.start", "title": "启动应用", "command": "npm run dev" },
    { "id": "db.reset", "title": "重置数据库", "command": "npm run db:reset", "confirm": true }
  ]
}
```

从“任务”标签运行工作区终端命令。任务可带 `description`；尤其共享仓库中，运行前检查命令。禁用插件只隐藏标签，不修改项目文件。

### 中继

随包分发的 Relay 提供跨会话工作提示词和技能，并在只读“中继”标签展示 `.pi-web/relays/` 计划与进度，不从标签启动或编辑中继。

普通模式在当前 agent 配置未安装时自动安装 Relay；从 **设置 → Pi 包** 移除会被记忆，不静默重装，可从“可用包”恢复。单独禁用中继插件只隐藏标签，不移除代理资源。管理嵌入的 `relay` 与 `relay-runner` 模板同步继续限定在授权工作区，不改变普通启动的技能文件。

<a id="workflows"></a>
### 工作流（Workflows）

Workflows 随包提供 Pi 工作流提示词和工作树操作。普通 profile 缺少默认包时自动安装，用户移除会被记忆，可从“可用包”恢复；禁用浏览器插件不移除已安装的 Pi 提示词资源。

工作树操作选择 base 与用途后，由目标机器重验项目、工作区和 Git base 再派发；仅在普通模式及所需能力可用时提供。创建工作树、发布会话与打开页面是独立结果，派发结果不确定或导航失败时不自动重试，先查看目标机器已有结果，避免重复工作树。实现示例见 [Workflows 包](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/pi-packages/workflows)。

### 试用 Captain's Log

Captain's Log 是可选示例，将会话最近的助手回复改写为海盗风格简报，演示浏览器面板、后端和 Pi 配套扩展协作。

1. 在目标机器的 **设置 → Pi 包 → 可用包** 安装 **船长日志**。
2. 在 **设置 → PI WEB 插件** 启用它。
3. 安全时重启目标机器会话守护进程，再刷新浏览器。
4. 选择会话，打开“船长日志”，点击“让船长来讲述”。

它随主包预构建发布，**默认不安装、不启用**，无需现场编译。读取源回复但不修改源会话，另建海盗会话；需要模型凭据，源文本会发给海盗会话的模型提供器，可能产生模型费用。已有结果会保存。守护进程重启后，可从“会话”打开已有海盗会话继续上下文。

详见[船长日志使用指南](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/pi-packages/captains-log/docs/usage.md)。

<a id="pi-extension-dialogs"></a>
## Pi 扩展对话框

Pi 扩展可请求确认、选择或文本输入；问题以内联方式展示，包括会话启动和工具等待阶段。刷新后仍可回答，多标签页最先回答生效。

有效期限取扩展超时和[宿主超时](https://pi-web.dev/config#extension-dialogs)中较早者。中止工作或替换运行时关闭相关问题。已回答卡片属于浏览器本地状态，不保证刷新后保留。新会话尚在创建时刷新可临时丢失卡片，但守护进程中的问题仍有期限。

仅支持这三种对话框，不支持自定义编辑器或组件等其他 Pi UI；不要因为 `hasUI` 为真就假定所有 UI 可用。

<a id="agent-development"></a>
## 代理开发

给代理具体目标、数据来源及允许的动作：

```text
为此项目创建 PI WEB 插件。
目标：<描述工作流和预期界面>。
先读 https://pi-web.dev/plugins.md，再按当前安装的 PI WEB 版本
查阅公开契约与示例。
只使用受支持的插件 API，不修改 PI WEB，不调用私有路由。
说明安装、权限或模型使用情况，以及刷新方式。
验证行为，包括失败和清理。
```

### 实现入口

从符合目标的最小示例开始。以下源码链接跟随 `main`；对发布版开发时，**使用对应标签或已安装的公开声明**。

| 需求 | 入口 |
| --- | --- |
| 浏览器贡献与帮助方法 | [plugin-api.ts](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/src/plugin-api.ts)，公开为 `@chainingintention/pi-web-cn/plugin-api` |
| 服务端生命周期、对等入口、提供器与宿主能力 | [server-plugin-api.ts](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/src/server-plugin-api.ts)，公开为 `@chainingintention/pi-web-cn/server-plugin-api` |
| 小型浏览器插件 | [信息](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/pi-web-plugins/info) |
| 独立浏览器/服务端包 | [工作区提供器示例](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/examples/workspace-provider-plugin) |
| 生产工作区提供器与配套 UI | [Git](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/pi-web-plugins/git) |
| 已托管会话、实时更新与 Pi 配套扩展 | [Captain's Log](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/pi-packages/captains-log) |
| 简单初始提示词工作流 | [工作区审查示例](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/examples/session-bridge-plugin) |
| 发现规则与诊断 | [插件目录](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/src/server/piWebPluginCatalog.ts) |

当前浏览器与服务端契约均为 **API v5**；宿主继续支持浏览器 **API v4** 和服务端 **API v3**，旧类型名兼容保留。catalog、作用域 backend 及 v5 贡献需使用对应 v5 入口，不将新功能直接塞进旧版本贡献。公开源码契约和已安装声明是签名、验证、限制与生命周期的依据。

- 在 `package.json` 的 `piWeb.plugins` 声明入口，参考独立示例的打包方式；同一包可含多个入口。
- 仅使用公开包入口，内部路由、服务及 `dist/**` 导入不是受支持 API。
- `browserRoot` 尽量窄，里面所有内容都对浏览器公开。包含所需依赖与资产，秘密放在之外。安装插件包限制为 **4,096** 项、**16 MiB**，不计 `.git`/`node_modules`。
- 机器/工作区操作使用宿主帮助方法，插件资产使用模块相对 URL，不硬编码应用路径。
- 面板没有重新挂载时也可能重复渲染。自己管理异步状态，组件生命周期清理连接、计时器与监听器。
- 工作区发现与会话支持功能分离，代理行为放在 Pi 配套扩展，而不是导入宿主内部模块。

<a id="trust-and-recovery"></a>
## 信任与恢复

**仅安装可信插件。** 浏览器入口在页面内运行；服务端入口在守护进程内使用其文件系统、环境及进程权限，没有独立沙箱。阻塞或故障服务端代码可影响同一守护进程所有会话；超时只能帮助配合取消的工作，不能停止阻塞代码。管理嵌入继续保留独立认证、授权资源、能力与审计边界，不向插件放开普通模式能力。

先在目标机器 **设置 → PI WEB 插件** 检查安装、启用、兼容和激活状态。浏览器失败看控制台，服务端失败在目标机器执行 `pi-web logs`。过期或需重启状态通常需要重启守护进程后刷新浏览器。

UI 无法恢复时，在目标机器直接运行：

```sh
pi-web plugins disable <plugin-id> --restart
pi-web plugins safe-start show
pi-web plugins safe-start set bundled-only --restart
pi-web plugins safe-start set none --restart
pi-web plugins safe-start clear --restart
```

- **disable** 禁止指定可选插件在下次启动加载，拒绝禁用必需终端。
- **bundled-only** 排除外部服务端插件，保留内置工具及必需终端。
- **none** 不导入任何服务端插件；诊断和项目目录工作区仍可用，但终端与依赖终端的工作流不可用。
- **clear** 修复或移除故障包后恢复普通启动。

安全启动持久保留直到清除。`--restart` 仅在识别到安全的已安装服务操作时重启，否则给出手动指引；配置在尝试重启前持久保存。命令离线编辑配置，不导入插件代码。自定义配置加 `--config /path/to/config.json`。有效 JSON 中不支持的 `serverPlugins.safeStart` 形状/值按 `none` 失败关闭；通过 `show`、`set` 或 `clear` 修复。重启前检查活跃工作。
