# 插件与 Pi 包

使用工作区工具、快捷操作和集成定制 PI WEB。可以安装现成的包，也可以让代理为具体工作流创建插件，无需修改 PI WEB 本身。

本指南说明可实现的功能和使用方式；实现时请查阅[公开契约与示例](#agent-development)，不要把本页作为第二份 API 声明。

## 内置中文语言插件

`zh-cn` 随包提供且默认启用；在机器配置设置 `plugins["zh-cn"].enabled: false` 后恢复英文，无需额外语言文件。刷新网页、下次启动 CLI、重启服务后生效，详见[配置参考](config.md#chinese-language-plugin)。浏览器默认中文来自网关，设备可在语言与区域设置选择其他界面语言；远端提示保持远端语言。

浏览器插件可通过激活上下文的可选 `translate(key, englishFallback, params)` 使用稳定消息键和命名参数；未提供翻译器或词条缺失时使用英文。语言插件以 `localizations` 贡献纯文本词典，不扫描 DOM 或注入 HTML。服务端激活上下文也可提供 `translate`，按所属机器配置格式化自有提示。旧插件 API 仍兼容；不要翻译用户输入、模型回复或代理转发的远端响应。Node 端只读取随包的 JSON 词典，不执行浏览器入口。

浏览器插件需要显式声明翻译类型时，可从公开入口 `@chainingintention/pi-web-cn/plugin-api` 使用 `import type` 导入 `Translator`、`TranslationParameters`、`TranslationMessages` 和 `LocalizationContribution`；服务端入口 `@chainingintention/pi-web-cn/server-plugin-api` 导出前两项。通过上下文调用翻译器，不要导入宿主内部的 `createTranslator` 或私有 `dist/` 路径。上下文的 `translate` 保持可选，兼容未提供该能力的旧宿主。

<a id="what-can-be-built"></a>
## 可实现的功能

浏览器 v5 还可用 [transcript renderers](#transcript-renderers) 定制内置工具条目及可见自定义消息的正文，不改变工具执行或历史。

| 目标 | 插件功能 |
| --- | --- |
| 展示项目健康状态、服务链接、环境信息 | 工作区标签与面板 |
| 添加仪表盘、文件查看器或项目工具 | 工作区面板、文件帮助方法与浏览器 UI |
| 方便查找常用操作 | 操作面板命令与快捷键 |
| 运行构建、测试或开发服务器 | 工作区终端命令 |
| 定制外观与界面布局 | 主题、明暗主题组合与网关展示区域 |
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

一个包可包含上述三种定制。安装包与启用 PI WEB 插件是独立操作；禁用插件不会移除包里的 Pi 扩展、技能或提示词。同一物理包通过多个来源别名配置时只发现一次并保留首个来源；不同安装即使共享插件 ID 仍按冲突处理。

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

v5 catalog 的会话投影包含布尔 `pinned`、运行状态 `not-hosted` / `idle` / `busy`，以及 `created`、`modified`、`archivedAt`（ISO 时间或 `null`）。未知时间不是旧时间；非归档会话 `archivedAt` 也是 `null`。按空闲年龄使用 `modified`，按归档时长使用 `archivedAt`；不要用归档文件的 mtime 替代。`pinned` 汇总保留作用域的保护，不只当前工作区。依赖这些字段需要更新宿主，没有独立能力回退。清理策略执行前重新读取资格和 pin；catalog 只读，实际变更使用[生命周期能力](#session-lifecycle)。

浏览器 API v5 的 `catalog` 固定到创建上下文时的机器，只读查询公开项目、工作区和会话投影，不返回 transcript 或内部会话路径。切换选择不会改变已保留 catalog 的目标；会话使用完整、区分大小写的精确 ID，不接受缩写。

可选 `backend` 指向同包配对的实际服务端入口：`backend.forScope({ kind: "machine" })`、`{ kind: "project", projectId }` 或 `{ kind: "workspace", projectId, workspaceId }` 返回请求/通道 peer。没有 session backend scope。宿主重新解析 authority，插件不传可信 cwd；机器与后端 revision 不匹配时拒绝，不静默使用网关同名后端。操作是否支持取决于实际 peer/capability，不由 API 版本单独保证。旧浏览器 v4 与服务端 v3 继续使用其原契约。

服务端可声明 `PI_WEB_HOST_CATALOG_CAPABILITY` 获取目标宿主的公开 catalog；Pi 配套扩展通过公开服务端入口的 `createCompanionBackend(pi.events, pluginId)` 发现本地配对 backend，要求在 PI WEB 已托管事件总线上运行。普通宿主会话连接不开放管理会话，完整特权也不取消该边界。普通 catalog 排除当前配置的管理 root；它不替历史文件补写耐久 scope，曾更换管理 root 的遗留文件需人工隔离。

<a id="styles-highlighting-and-display"></a>
### 样式、高亮与显示文本

v5 `stylesheets` 贡献包含 `id`、HTTP(S) `url` 和可选 `order`（默认 `1000`，较小先加载，同序按限定贡献 ID）。使用模块相对 URL 生成 CSS 文件地址，文件内资产相对 CSS 地址解析；不支持内联 CSS 或运行时 `@import`。新主题通过[静态包元数据](#css-first-themes)声明；运行时 themes/themePairs 已弃用但继续兼容并发出警告。v5 主题使用样式表；需要共享样式的组件使用公开 `StylesheetIntegrationCapabilityV1` 注册 shadow root 或创建 Lit lifecycle controller，并在断开时释放。主题属于网关应用，浏览器设备偏好优先于网关默认值。

共享基础 UI 通过 `{ pluginId: "pi-web", id: "stylesheet-integration", version: 1, parse }` 声明依赖并在 `start` 中解析；组件使用 `createController(this, { sharedUi: true })` 或 `registerRoot(root, { sharedUi: true })`。省略 opt-in 只接收贡献样式，不接收共享按钮、选择器、工具栏、标签和文件行。宿主持有注入、排序与清理；原生事件、键盘交互、焦点与 ARIA 仍由消费者持有。共享 UI 不包含菜单、表单和对话框，插件不得深导入客户端私有样式。

`stylesheet-integration` 能力可由支持的浏览器 v4/v5 入口声明，能力版本与入口版本独立；这不使旧入口获得 v5 专属的 `stylesheets` 贡献字段。

基础主题同步提供默认布局与控件表现，主题 CSS 可扩展配色与布局；基础规则在 `pi-web-base` cascade layer，普通未分层主题规则遵循 CSS cascade 覆盖。[主题样式契约](theme-styling-contract.md)列明受支持的消息、选择、导航行、编辑器及菜单挂钩；其余内部选择器、共享类和外观仍属实验性，不因能力版本而冻结；具体控件入口见[共享 UI 导航](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/ui-primitives.md)。

宿主锚点弹层支持面板 CSS 变量 `--ui-popup-placement`，可取 `below-end`、`below-start`、`above-start` 或 `left-end`。宿主显式定位选项优先；未指定选项时读取该变量，空值或不支持的值使用默认 `below-end`。样式只选择首选对齐，宿主仍按可见视口约束尺寸并在必要时切换上下方向，继续管理焦点和弹层关闭。

v5 `syntaxHighlighters` 返回有序、不重叠的 UTF-16 范围 token，不返回 HTML；宿主负责安全显示，插件遵守输入 `signal`。v5 内容渲染器还可提供 `title`、同步 `supports(request)`，并接收机器、语言和文件路径提示；正文仍是不可信输入，净化与清理要求不变。精确签名以公开声明为准。

Pi 的 Markdown transformer 链在 daemon 的浏览器投影阶段运行，仅对完成及历史的用户、assistant 文本和 thinking 派生 `displayText`；部分流式文本完成后才应用，文件预览不受影响。canonical 消息、持久化历史、模型输入、审计原文和实际 `thinkingLevel` 不变。“复制消息”和消息操作使用原文；代码围栏的 Raw/Copy 使用变换后的围栏源码。

<a id="ui-presentation"></a>
### 界面展示区域

浏览器 API v5 的 `uiPresentations` 贡献以 `id`、`region` 和同步 `render(context)` 声明展示区域。插件必须声明 `{ pluginId: "pi-web", id: "ui-presentation", version: 1, parse }` 依赖。展示贡献属于整个网关应用，不接受远端或机器专属注册；每个区域只允许一个所有者，重复贡献会拒绝激活。

| `region` | 宿主提供的命名插槽 |
| --- | --- |
| `navigation` | `header`、`machines`、`projects`、`project-resize`、`workspaces`、`workspace-resize`、`sessions` |
| `context-bar` | `content`、`actions` |
| `chat-chrome` | `transcript`、`composer` |
| `settings-navigation` | `navigation` |
| `files-toolbar` | 无；使用宿主提供的文件操作 |

`files-toolbar` 的 `context.actions` 提供 `new-file`、`new-folder`、`upload`、`download`、`rename`、`delete`、`refresh`；`download` 仅在选中文件时出现。动作的标签和禁用状态由文件宿主持有，插件负责展示；宿主拒绝禁用动作及已失效的面板、选择或展示生命周期中的旧回调。该区域不替换文件预览标题栏的下载入口，也不接管独立的管理 `AGENTS.md` 菜单。

`UiPresentationCapabilityV1` 的可选 `render(context)` 返回区域模板或 `undefined`，`subscribe(listener)` 返回取消订阅函数，`fail(region, error)` 将错误交给网关展示失败边界并返回是否处理。文件面板通过这些方法使用同一展示生命周期；旧宿主未提供方法或当前没有可用模板时，保留默认工具栏。

`navigation` 贡献可选声明 `navigationLayout: "tree"`，请求宿主将原有列表组合为选中分支树：在选中项目下展开工作区，在选中工作区下展开会话；普通文件夹省略重复的工作区层。其他区域不能声明该字段，不支持的布局值会拒绝激活。树模式采用静态分区标题，由节点展开控件管理分支，不沿用手机独立列表的单层互斥折叠；定向定位工作区或会话时先展开所选祖先。展开和选择由宿主控件处理，数据仍由原有 controller 按当前选择加载；插件不会因此获得未选中分支的会话数据。未声明时保留宿主的独立列表布局与折叠偏好。

渲染器使用 `context.slots` 中的名称输出 `<slot name="...">`，不查找、移动或重建宿主控件。宿主持有编辑器和消息视图的生命周期，界面切换不重建它们；导航列表可随树形与独立布局切换重新装配，操作仍复用宿主菜单、信任入口和权限检查。上下文仅含普通/管理模式、紧凑布局标记及机器、项目、工作区、会话的只读标识和显示名称；可选操作由宿主按权限提供，并在选择或生命周期变化后失效。调用操作时还会核对展示贡献当前是否活动，未重绘前失去活动资格也不能执行保留的回调；界面回退后，旧快照不会因贡献恢复活动而重新生效。它不提供凭据、消息正文、内部路径或普通宿主会话连接，管理视图也不因此获得额外权限。

禁用或缺少展示贡献时使用宿主默认界面，并恢复独立导航列表。展示渲染失败时，宿主停止使用该插件的运行时贡献（包括展示、样式与运行时主题），报告错误并回退；网关声明式静态主题目录不因此移除。插件仍是可信代码，此机制不是执行沙箱。布局 API 与样式表互补，精确类型以公开 `plugin-api` 声明为准。

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

Promise 在恢复完成时结束，也可在被较新导航取代时正常结束。缺失或不可用的目的地使用普通宿主 UI，不再额外拒绝 Promise。参数类型错误或无效 `view` 会在改变 URL/UI 前以 `TypeError` 拒绝。

### Transcript renderers

Browser v5 plugins can contribute `transcriptRenderers` to customize tool entries, including built-in tools, and displayed custom messages. The host retains the transcript frame and its controls; the plugin supplies the entry body. Rendering changes presentation, not tool execution or session history. Hidden custom messages remain hidden; this API does not expose `appendEntry`.

Each contribution has a unique local `id`. Declare the host capability `pi-web/transcript-rendering@1` (`pluginId: "pi-web"`, `id: "transcript-rendering"`, `version: 1`) in `requires` when the plugin needs this feature on older hosts. The capability is a feature marker; rendering uses contributions, not capability methods.

**Tools** contribute `{ id, target: "tool", resolve(toolName, next) }`. There is no declarative `toolName` field: the resolver chooses which names to handle. Resolvers run synchronously in plugin discovery order, so the first resolver gets first refusal. Asynchronous import completion does not change that order. A resolver returns a `TranscriptToolRenderer`—an object with `render(input): TemplateResult | undefined`—or `undefined`.

- **Delegate:** return `next()` for a name you do not handle.
- **Replace:** return your own renderer without calling `next()`.
- **Wrap:** call `next()` to obtain the downstream renderer, then return a renderer that calls `downstream.render(input)` and decorates its result.

`next()` returns renderer callbacks, not HTML. Treat the returned renderer as read-only; return a new renderer object to replace or wrap it. The web transcript supplies its core default renderer at the end of the chain, so wrappers can decorate the normal tool card as well as another plugin's renderer. Delegating unchanged all the way to that default keeps the normal view without a custom-view toggle. The resolver type still permits `undefined` for contexts without a supplied default. Returning `undefined` from a resolver ends selection; the host does not automatically try later resolvers and instead shows the core fallback. Returning `undefined` from a selected renderer's `render` also shows that fallback without restarting selection.

**Custom messages** contribute `{ id, target: "custom-message", customType, render }`. The first eligible contribution in discovery order with an exact, case-sensitive `customType` wins, like TUI custom-message rendering. Messages have no `next` callback. Declining or failing does not try a later matching message renderer.

The [standalone example](https://github.com/jmfederico/pi-web/tree/main/examples/transcript-renderer-plugin) demonstrates actual tool chaining: a wrapper resolver precedes the checks renderer in the same contribution array. Its core pattern is:

```ts
{
  id: "checks-wrapper",
  target: "tool",
  resolve(toolName, next) {
    if (toolName !== "example_checks") return next();
    const downstream = next();
    if (!downstream) return undefined;
    return {
      render(input) {
        const body = downstream.render(input);
        return body === undefined ? undefined : html`
          <div><p>Rendered by the example plugin</p>${body}</div>
        `;
      },
    };
  },
}
```

`scope` contains `machineId` and `sessionId`, with optional `projectId` and `workspaceId`. A tool `entry` contains `toolName`, `status` (`pending`, `running`, `success`, or `error`), and optional `toolCallId`, `args`, `content`, `details`, and `resultText`. A custom-message `entry` contains `customType`, `content`, and optional `entryId` and `details`. Treat opaque `args`, `content`, and `details` as untrusted data: validate your own schema before using them.

Both tool and message `render` callbacks receive `{ scope, entry, signal, fail }`. Rendering is synchronous and returns a Lit `TemplateResult` or `undefined`; returning a Promise is unsupported. Unlike resolver delegation through `next()`, returning `undefined` from `render` declines the current body and retains the existing view without restarting selection. An empty template deliberately renders an empty body. A thrown error or `fail(error)` restores the existing view. The host's default-view control also lets the user bypass the custom body.

Rendering may repeat as inputs change. Keep it repeatable and do not execute tools or session operations as a side effect of rendering. Honor `signal` for asynchronous work and release resources: it aborts when inputs change, the entry unmounts, the plugin is disabled, or the user selects the default view. Report asynchronous failures through `fail`; obsolete calls are ignored.

Use the existing [stylesheet integration](#styles-highlighting-and-display) for plugin-owned shadow roots and [theme tokens and cascade layers](theme-architecture.md) for appearance. The host's frame remains core-owned; renderer bodies do not replace it or introduce a separate styling contract.

### 聊天与文件内容预览

浏览器插件的 `contentRenderers` 提供 `id`、围栏 `languages` 或不含点的 `fileExtensions`，同步 `render(input)` 返回 Lit 模板。`renderMode` 默认为 `manual`，用户选择命名视图后才激活；`automatic` 可自动显示。v5 还可用 `title` 命名视图、同步 `supports(request)` 判断资格，并接收机器、语言和文件路径提示；旧 v4 输入不变。

同一渲染器用于聊天围栏、文件 Markdown 围栏和独立文本文件，并遵循所属机器可用性。浏览器先发现 bundled 默认插件，再发现 installed 覆盖，各组内部顺序保持不变。匹配项保持插件发现顺序，最后一个匹配的 automatic 渲染器是默认；后来的 manual 渲染器不抢占自动默认。异步加载完成顺序不决定优先级，用户显式选择优先。每个渲染器与“源码”（Raw）是单行横向滚动的命名按钮，同时仅挂载所选预览，不使用选择器菜单。

聊天按代码块在当前标签页记忆显式渲染器与源码选择：从最后一次显式选择起 **15 分钟**，最多 **128** 个最近选择块，作用域包含机器、会话、entry、part、块和精确源码。重新挂载不延长期限，源码变化或渲染器不可用时恢复默认；页面重载清除记忆。独立文件使用自己的浏览器源码/预览偏好，URL 模式优先，默认策略不自动变成用户偏好。

Raw 始终提供未高亮源码，Copy 复制当前代码块源码，即使正在预览也不复制图形。未闭合围栏、截断及超过 **100,000 UTF-16 码元**的输入不渲染；文件另有内联字节限制。渲染失败回退源码；追加正文不重启未变的闭合块，切换视图中止旧工作。Mermaid 图形保持手动激活，代码高亮与图形预览是独立视图。

`input` 的 `signal` 和 `fail(error)` 用于生命周期及异步错误；断开或中止时清理，过期错误不影响新视图。正文不可信，保留聊天和文件各自的净化器，不执行源码或放宽策略。

消费者在 `requires` 声明 `{ pluginId: "pi-web", id: "content-rendering", version: 1, parse }`，在 `start` 解析。`ContentRenderingCapability` 提供 `listRenderers(request)`、`renderText(request)` 和 `renderMarkdown({ machineId, text, truncated?, toSafeHtml, allowManualPreview? })`。列表按发现顺序返回 `{ id, label, renderMode }`，不调用渲染器。

只有 `controls: "external"` 的 `renderText` 接受 `rendererId`，缺失或不可用时使用上述默认规则；内嵌控件自己拥有选择。消费者使用外部控件时自己提供视图选择、源码访问及移除预览。`allowManualPreview: true` 可授权手动预览，但不覆盖逐块 Raw 选择；文件与聊天各自持有用户意图，能力不持久化偏好。`renderMarkdown` 使用消费者可信净化器。精确签名见[公开浏览器契约](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/src/plugin-api.ts)。

### 公开会话数据与消息操作

会话快照中的 `metadata` 只包含主动发布的 UI-safe 命名空间数据，不暴露任意 custom entries。命名空间不构成权限或所有权隔离，插件须校验自己的 schema 并安全显示；旧宿主可省略该字段。服务端发布与浏览器读取都不应放入秘密。

`messageActions` 默认针对持久 entry，调用时提供受保护的 `history.fork()`/`goBack()`；`target: "display"` 针对当前显示切片，可包含未持久化文本，但没有历史操作助手。两者提供的普通原文均排除 thinking/tool payload，不使用派生 `displayText`。可见性和可用性判断同步且无副作用，真正操作由调用上下文固定到原机器/会话；插件自己决定确认。

### 会话与配套扩展

宿主 Pi sessions 能力的 `run()` 接受可选 `model`（精确 `provider/model-id`）和 `thinkingLevel`；省略使用普通会话默认值，返回 handle 可包含有效启动设置。宿主不静默替换不可用覆盖；错误码 `PI_SESSION_MODEL_UNAVAILABLE` 或 `PI_SESSION_THINKING_UNAVAILABLE` 保证未提交初始提示，调用者可显式移除被拒覆盖再重试。其他启动/完成错误不提供该保证；[定时任务](scheduled-tasks.md#model-and-thinking-overrides)记录自己的设置回退。

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

`npm run dev:web` 默认启用 `PI_WEB_DEV_PLUGIN_PAIRING=1`，允许开发浏览器 UI 连接尚未重启的后端；设为 `0` 恢复严格配对。生产与其他启动路径默认严格。此开关不热替换后端，服务端变化仍需手动重启 daemon。


代理可在任意目录开发包，再链接到本地插件目录：

```sh
mkdir -p ~/.pi-web/plugins
ln -s /path/to/plugin-folder ~/.pi-web/plugins/my-plugin
```

设置 `PI_WEB_DATA_DIR` 时改用 `$PI_WEB_DATA_DIR/plugins`。无需重建 PI WEB，但包必须包含编译后的 JavaScript；宿主不编译任意已安装插件源码。未打包的浏览器模块须使用可解析的相对导入并带 `.js` 扩展名，渲染使用宿主提供的 `html`/`svg`，不要依赖未解析的裸运行时导入（如 `lit`）；已打包的导入同样可用。

<a id="remote-machines"></a>
## 远端机器

安装与设置针对设置中选中的机器。远端服务端代码运行在远端，浏览器界面经网关显示。文件、终端、对等帮助方法保留机器作用域。机器专属插件使用该机器自身安装；便携的纯浏览器插件可复用网关副本。主题属于整个应用，远端主题贡献忽略。

此 API 迁移期间网关与目标一起升级，重启更新后的 Web/API 与相关会话守护进程，再刷新浏览器。混合版本会使远端插件（包括 Git）不可用，宿主不静默替换为网关后端。

<a id="included-tools-and-optional-packages"></a>
## 内置工具与可选包

- **Custom UI Codex** 随包提供且默认启用，提供 Codex 风格导航、聊天外围布局、设置导航及明暗主题。它将宿主的上下文用量与会话费用状态条紧邻输入框下方对齐显示，不复制数据计算或警告行为；发送按钮左侧不显示分隔线，主操作位空闲发送、运行中常显停止，保留独立引导和键盘排队。它只改变展示，中文语言插件与功能权限保持独立。可在网关的插件设置中禁用并刷新页面，恢复宿主默认界面；浏览器插件变更不要求重启 daemon。
- **终端**提供终端和命令运行，是普通启动的必需插件，仅紧急安全启动可跳过。
- **文件**提供文件浏览、预览、上传；禁用面板不移除其他插件的文件帮助方法。
- **Git**发现工作区并显示状态/差异；禁用后保留项目目录工作区，除非其他提供器认领。
- **Mermaid**默认手动模式，点击“渲染”预览 `mermaid` 围栏和 `.mmd`/`.mermaid` 文件。内置引擎在不透明来源、网络受阻的沙箱中本地运行，不发送源码给图表服务。交互链接和外部资源不可用。禁用后保持代码显示；纯浏览器插件只需刷新页面。
- **信息**作为应用级面板显示 PI WEB 状态与可复制诊断，无需先选择工作区。
- **更新**在需要时显示更新/重启建议，并提供手动检查。
- **工作区任务**将项目命令显示为可运行操作，与定时派发对话不同。
- **Session naming** 可移除 Pi 扩展，负责新会话首条提示命名；配置与迁移见[会话命名](config.md#session-naming)。
- **Scheduled agent tasks（beta）** 可选包，提供代理管理的计划与只读“计划任务”面板；Web 插件默认禁用。安装、时区及执行历史见[指南](scheduled-tasks.md)。

<a id="managed-agents-review"></a>
### 管理工作区指令

管理嵌入的文件工具栏提供 `AGENTS.md` 二级菜单。待确认表示工作区文件内容与授权当前模板不同，与模板/本地文件时间戳或旧“不覆盖”决定无关；时间戳元数据只用于显示。存在待确认内容时，入口按钮右上角圆点脉冲提示，减少动态效果时为静态。每个模板指纹首次检出不一致会自动打开既有复核弹窗并说明原因；弹窗实际展示后，显式 acknowledge 只记录已阅、不改文件。关闭菜单或按 Escape 不构成覆盖或不覆盖决定。

“覆盖并备份”先将当前工作区的原文件保存到 `.pi-web/agents-backups/`，再写入授权项目提供的模板；“不覆盖”保留文件并记录该模板已阅，但内容仍不同，圆点继续显示，之后仍可手动覆盖并备份。已阅按工作区保存在现有状态中并兼容既有 v1 记录。同一模板指纹在已阅后若文件再次变化，圆点恢复但不自动弹窗；模板正文、修订或 `updatedAt` 变化会产生新指纹，不一致时可再次自动弹出一次。当前签名上下文中的模板是唯一来源；未刷新上下文时，不承诺检测远端平台侧模板变化。

确认针对当前机器、项目和工作区，切换工作区不会将旧请求结果应用到新位置。网关重新验证管理身份与工作区授权；浏览器不能指定模板正文、任意路径或备份位置。确认期间文件或模板已变化时，返回冲突而不覆盖，需重新查看后决定。缺少文件时的首次创建仍沿用项目初始化规则；已有文件不因项目解析或会话初始化自动替换。

指令确认只处理不超过 **1 MiB** 的普通文件，拒绝文件或相关托管目录的符号链接。备份保留原有 `AGENTS.<timestamp>.<fingerprint>[suffix].md` 命名，不覆盖历史备份。POSIX 平台确认覆盖时保留原文件访问权限，目标缺失时以 `0600` 创建；备份也以 `0600` 创建，仅文件所有者（服务账号）可读写。Windows 访问控制仍由系统 ACL 决定，不以 POSIX 权限位承诺隔离。

公开工作区文件能力的可选 `files.managedAgents` 提供 `status(options?)` 与 `decide({ action: "overwrite" | "keep" | "acknowledge", revision })`。`status` 返回不可用状态 `{ available: false }`，或带 `available: true`、`pending`、不透明 `revision`、文件修改时间 `modifiedAt`、平台模板更新时间 `templateModifiedAt` 和 `templateRevision` 的快照；两个时间字段可为 `null`。新宿主还会成对提供可选 `promptPending` 与不透明 `promptRevision`；缺失时只提供手动复核，不发送 acknowledge 请求。`revision` 仍是完整快照 CAS 标识，不是稳定模板身份。`decide` 必须提交所查看快照的 `revision`，返回决定后的状态。普通模式及旧宿主可省略此能力，插件应按能力是否存在展示入口，而不是自行拼接私有请求。

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

从“任务”标签运行工作区终端命令，面板显示最终成功或失败，并在可用时显示退出码。管理嵌入通过受控 `terminal-command-runs` 执行已授权的任务，交互终端仍禁用，任务面板不提供命令输出。任务可带 `description`；尤其共享仓库中，运行前检查命令。缺少 `.pi-web/tasks.json` 表示尚未配置任务，不是加载故障。禁用插件只隐藏标签，不修改项目文件。

### 接力

随包分发的接力（Relay）提供跨会话工作提示词和技能，并在只读“接力”标签展示 `.pi-web/relays/` 计划与进度，不从标签启动或编辑接力。缺少该目录表示当前工作区没有接力包，不是加载故障。协议标识与文件路径中的 `relay` 保持不变。

普通模式在当前 agent 配置未安装时自动安装接力包；从 **设置 → Pi 包** 移除会被记忆，不静默重装，可从“可用包”恢复。单独禁用接力插件只隐藏标签，不移除代理资源。管理嵌入的 `relay` 与 `relay-runner` 模板同步继续限定在授权工作区，不改变普通启动的技能文件。

安装并启用接力包、且会话允许委派时，受限管理模式可通过 `dispatch_relay` 派发独立的后继会话；派发桥接继承发起者管理 context，并沿用同一项目的工作区授权。显式拒绝 `dispatch_relay` 或关闭委派仍会阻止派发；不以通用 `spawn` 替代，也不开放普通插件对管理会话的访问。

<a id="workflows"></a>
### 工作流（Workflows）

Workflows 随包提供 Pi 工作流提示词和工作树操作。普通 profile 缺少默认包时自动安装，用户移除会被记忆，可从“可用包”恢复；禁用浏览器插件不移除已安装的 Pi 提示词资源。

工作树操作选择 base 与用途后，由目标机器重验项目、工作区和 Git base 再派发；仅在普通模式及所需能力可用时提供。创建工作树、发布会话与打开页面是独立结果，派发结果不确定或导航失败时不自动重试，先查看目标机器已有结果，避免重复工作树。实现示例见 [Workflows 包](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/pi-packages/workflows)。

<a id="pi-extension-dialogs"></a>
## Pi 扩展对话框

Pi 扩展可请求确认、选择或文本输入；问题以内联方式展示，包括会话启动和工具等待阶段。刷新后仍可回答，多标签页最先回答生效。

有效期限取扩展超时和[宿主超时](https://pi-web.dev/config#extension-dialogs)中较早者。中止工作或替换运行时关闭相关问题。已回答卡片属于浏览器本地状态，不保证刷新后保留。新会话尚在创建时刷新可临时丢失卡片，但守护进程中的问题仍有期限。

仅支持这三种对话框，不支持自定义编辑器或组件等其他 Pi UI；不要因为 `hasUI` 为真就假定所有 UI 可用。

## V5 display and transport

### Contribute file previewers

Browser v5 plugins can contribute `filePreviewers` to the existing Files panel. Use these for file-specific views, including binary formats; use `contentRenderers` for text presentations shared with chat code blocks. A previewer does not need its own file browser or companion backend.

Each previewer declares an `id`, a human-readable `title`, and `fileExtensions` (without leading dots), `mimeTypes` (exact types or `audio/*`-style wildcards), or a synchronous `supports(request)` callback. Extension and MIME selectors are alternatives; `supports`, when supplied, further restricts them. With only `supports`, it decides eligibility. Matching is case-insensitive. Unknown formats may have no MIME metadata, so extension matching is useful.

```ts
export default {
  apiVersion: 5,
  name: "Custom file views",
  activate({ html }) {
    return {
      contributions: {
        filePreviewers: [{
          id: "model",
          title: "3D model",
          fileExtensions: ["mesh"],
          supports: ({ file }) => file.size <= 20 * 1024 * 1024,
          // Manual by default: no rendering or file fetch until selected.
          render({ file, files, signal, fail }) {
            return html`<my-model-viewer .path=${file.path}
              .files=${files} .signal=${signal} .fail=${fail}></my-model-viewer>`;
          },
        }],
      },
    };
  },
};
```

The plugin owns `my-model-viewer` in this example. Its component can fetch existing workspace bytes using the supplied file helpers:

```ts
if (files.capabilityVersion !== 1) throw new Error("Workspace download URLs are unavailable");
const response = await fetch(files.downloadUrl(path), { signal });
if (!response.ok) throw new Error(`File load failed: HTTP ${response.status}`);
const bytes = await response.arrayBuffer();
```

This uses the same authenticated file-serving path as downloads, including remote machines. `Content-Disposition: attachment` does not trigger a download when using `fetch()`. For browser media, construct a `Blob` with the appropriate MIME type and revoke its object URL during cleanup. Fetching into a blob loads the whole file; apply a suitable size limit. A companion backend is optional for processing, generated resources, or plugin-managed range streaming; see [binary resources](#binary-resources-and-media-delivery).

Files shows all eligible previewers as named view buttons and keeps **Download** available. Images, SVG, PDF, HTML, and Markdown are contributions from the bundled Files plugin, using the same discovery, selection, and lifecycle API as Audio and third-party previews. Existing text `contentRenderers` are adapted into this file-preview pipeline; their chat behavior and public contribution API remain unchanged. Files itself owns only selection, Raw source, and download fallback. `renderMode: "automatic"` opts into automatic rendering; otherwise selection is explicit. Later matching automatic previewers take precedence over earlier defaults, but an explicit view choice takes priority. Raster images and PDF opt into automatic rendering. SVG, HTML, and Markdown keep Raw as their fresh-browser default; a saved or linked Preview preference activates their registered previewer. Built-in document previewers retain the core size limits, safe file URLs, HTML sandboxing, and native PDF policy. Previewers can handle large files without inheriting the core inline-preview size cap; they must enforce their own limits.

`render` receives a frozen file snapshot, `machineId`, `projectId`, `workspaceId`, workspace `files`, and—when this package has one—its own paired `backend`. It never receives another plugin's backend. The host aborts `signal` when the file, selected view, mounting, or plugin lifetime changes. Stop requests and release media, object URLs, observers, and workers when aborted or disconnected. Report asynchronous failures through `fail(error)`; synchronous failures are caught by the host. Files displays the failure and retains a source/download fallback; failures from obsolete previews cannot replace a newer selection.

For another file-view consumer, require the host capability `{ pluginId: "pi-web", id: "file-previewing", version: 1 }`. Its `listPreviewers(request)` discovers matching views and `renderPreview({ ...request, previewerId, files, fail })` mounts one selected view with the same lifecycle handling. Supply the actual machine and authoritative project/workspace IDs. Require this capability when your plugin must fail explicitly on older hosts rather than run without file-preview support.

The bundled [Audio plugin](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/tree/main/pi-web-plugins/audio) is a complete consumer example. No DOCX conversion is included.

### Highlight additional languages

The bundled **Code highlighting** plugin supplies one **Highlighted** renderer, offered only for languages it supports. Browser v5 plugins can extend it with `syntaxHighlighters` for any language, including languages that PI WEB does not recognize on the server. Match chat fences with `languages` (including aliases) and files with `fileExtensions` (without a leading dot). Adding a grammar expands this renderer's coverage; it does not add a separate renderer choice. Highlighting is available in completed chat fences, Markdown files, and standalone Files previews. **Raw** stays unhighlighted.

Use any tokenizer or grammar bundled with your plugin. The `highlight({ text, signal })` callback returns tokens synchronously or asynchronously: `{ from, to, kind }`, with UTF-16 offsets into the unchanged source. Ranges must be ordered, non-overlapping, non-empty, and within the source. Unmarked text remains plain. Kinds are `keyword`, `string`, `number`, `comment`, `type`, `function`, `variable`, `operator`, `punctuation`, `property`, `literal`, or `meta`; PI WEB supplies theme-aware colours. Return tokens, not HTML or CodeMirror extensions, so independently bundled parsers do not need to share an editor-library instance with the host.

Plugins should stop asynchronous work when `signal` is aborted. Oversized input is not sent to highlighters. A failed highlighter leaves source readable and reports the failure. If several grammar contributions match, the last discovered one wins. Highlighting adds no editing, completion, language-server support, or plugin-defined styling.

A plugin can instead provide an independent highlighting system as a `contentRenderers` contribution. Both highlighting renderers remain separate choices when they support the source; the same last-automatic-renderer rule chooses the default. A v5 renderer's `supports(request)` callback can determine eligibility dynamically, and `title` names its view button—for example, **Highlighted** or **Diagram**. Without a title, the host uses the plugin and contribution IDs. V5 rendering receives the source language, file path, and machine as well as the text; v4 renderer inputs retain their original text, signal, and failure callback. The bundled highlighting plugin demonstrates this pattern.

The bundled Mermaid plugin contributes both a **Diagram** renderer and a source grammar for `mermaid` fences and `.mmd`/`.mermaid` files. Its grammar adds **Highlighted** to those sources without loading the diagram engine. Diagram rendering stays manual; **Raw**, **Highlighted**, and **Diagram** retain the same source text. The lightweight grammar colours common Mermaid syntax; it does not validate diagrams.

Older hosts ignore syntax-highlighter contributions; require the host capability `{ pluginId: "pi-web", id: "syntax-highlighting", version: 1 }` when your plugin depends on this feature. This capability exposes `supports()` and `highlight()` for renderers that consume semantic token contributions. See `SyntaxHighlighterContribution`, `SyntaxHighlightingCapability`, and `ContentRendererContributionV5` in the [public browser contract](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/src/plugin-api.ts).

### Binary resources and media delivery

Use a **resource** to deliver bytes from a plugin's server entry to its browser entry. Resources are general-purpose: generated reports, audio, converted documents, and other binary results use the same transport. Resources provide transport, not viewer registration: pair them with [file previewers](#contribute-file-previewers) when the result belongs in Files. They do not change the core file-preview allowlist.

A server v5 peer can implement `resource` alongside `request` and `openChannel`, or by itself. The callback receives the operation, JSON input, cancellation signal, and host-resolved machine/project/workspace scope. It returns `ServerPluginResourceResponse`: a `Uint8Array` or asynchronous iterable of byte chunks, a `contentType`, and optional `contentLength`. Node readable streams can be used as asynchronous iterables.

```ts
// Server entry: no separate HTTP listener or public port.
export default {
  apiVersion: 5,
  name: "Generated reports",
  activate() {
    return {
      peer: {
        resource({ operation, scope, signal }) {
          signal.throwIfAborted();
          if (operation !== "summary" || scope.kind !== "workspace") {
            throw new Error("A workspace summary was requested outside its scope");
          }
          const body = new TextEncoder().encode(`Workspace: ${scope.workspace.label}\n`);
          return { body, contentType: "text/plain; charset=utf-8", contentLength: body.byteLength };
        },
      },
    };
  },
};
```

In a browser v5 panel or action, capture the desired scope and feature-detect `resourceUrl`:

```ts
const peer = context.backend?.forScope({
  kind: "workspace",
  projectId: context.workspace.projectId,
  workspaceId: context.workspace.id,
});
if (peer?.resourceUrl === undefined) throw new Error("Update PI WEB and restart its session daemon to use resources");
const url = peer.resourceUrl("summary", null);
const response = await fetch(url, { signal });
if (!response.ok) throw new Error(`Summary failed: HTTP ${response.status}`);
const summary = await response.text();
```

`resourceUrl()` returns an absolute, browser-ready URL. Use it directly with browser APIs or media elements; do not resolve it again or construct private routes. The URL captures the package revision, machine, and scope. Every load uses normal PI WEB authentication and re-resolves authority on the owning machine, including remote machines. A URL is not a public share link or a bearer credential. Resource URLs from older revisions fail rather than silently invoking new plugin code.

Resource selectors are JSON of at most **4 KiB UTF-8** and appear in the URL. Keep them short and non-secret; URLs can appear in history and logs. Use a normal backend request for large or private inputs, then select a plugin-owned result by a short opaque identifier. Resource callbacks serve GET requests and should not start mutating jobs; browsers may repeat loads or request ranges.

For seeking or partial downloads, the callback receives the optional HTTP `range` string. A plugin may ignore it and return a full `200` response, or implement range handling with `statusCode: 206`, `contentRange`, `contentLength`, and `acceptRanges: "bytes"`. Unsatisfiable ranges use `statusCode: 416` and `contentRange: "bytes */TOTAL"`. PI WEB forwards these fields; it does not seek or slice plugin-owned data. Plugins must validate range requests against their actual resource.

The host streams bytes with backpressure rather than wrapping them in JSON/base64. It validates response metadata and any declared length, cancels work on disconnect or daemon shutdown, and limits resource lifetimes and concurrency. Plugins must honor `signal`, release their own resources, and apply format-specific size and conversion limits. File reads and conversions belong to the plugin: resolve file inputs against the host-provided scope and validate browser-supplied selectors.

Responses are private, uncached, and protected by host-owned MIME and sandbox policies; plugins cannot supply arbitrary HTTP headers, cookies, or redirects. HTML and SVG documents remain sandboxed. Native PDF responses omit the sandbox restriction but retain restrictive CSP and `nosniff`. Inserting fetched HTML into a panel bypasses document isolation: sanitize it before rendering, and never execute untrusted document content.

After upgrading PI WEB for this API, restart the affected session daemon when safe, then reload the browser. Gateways and remote machines must both support resources. This transport does not add resource methods to companion Pi extensions; those continue to use requests and channels.

### File icon themes

Files and Git display extension-specific shapes from one selected icon theme in a single muted tone. The active colour theme supplies the grey for both light and dark appearances. Git shows change status through filename colours and status labels in both list and tree views. Material icons are bundled locally by default, using the pinned npm package at build time rather than a tracked SVG collection. Choose an icon theme or generic file icons in **Settings → General → File icons**. This choice belongs to the current browser, not the gateway configuration.

Browser API v5 plugins can contribute complete sets through `fileIconThemes`:

```ts
fileIconThemes: [{
  id: "my-icons",
  name: "My icons",
  file: { url: new URL("./file.svg", import.meta.url).href },
  files: [{
    filenames: ["Dockerfile"],
    icon: { url: new URL("./docker.svg", import.meta.url).href },
  }, {
    extensions: [".ts", ".tsx"],
    icon: {
      url: new URL("./typescript.svg", import.meta.url).href,
    },
  }],
}]
```

`file` is the fallback asset. Matching uses only the basename, without reading file contents: exact filenames win over extensions, longer extensions win over shorter ones (such as `.d.ts` before `.ts`), and declaration order breaks ties. Matching is case-insensitive. Directory disclosure arrows are unchanged. Asset URLs must be absolute HTTP(S) URLs. Use SVGs with transparent backgrounds and recognisable alpha silhouettes; other transparent browser image formats work too. Opaque fills become solid shapes, regardless of their original colours. Bundle assets under the plugin's browser-public root and use module-relative URLs; with Vite, prevent small assets becoming data URLs. Icons render as decorative CSS alpha masks, never injected SVG markup, and failed image loads fall back to the generic file icon. Remote assets require CORS and depend on network access and the deployment's content security policy; bundled assets avoid third-party requests.

Like colour themes, icon themes are app-wide and only gateway contributions are used. A missing selected theme temporarily falls back to Material without erasing the browser choice. Plugins consuming the selected icons can require `{ pluginId: "pi-web", id: "file-icons", version: 1 }` and use its `FileIconsCapability`: `resolveIcon(path)` returns the current mask asset URL or `undefined` for generic icons, and `subscribe(listener)` reports selection, colour-scheme, and contribution changes. Unsubscribe on disconnect and subscribe again on reconnect or capability replacement.


### Maintenance terminals

The Terminal plugin provides machine-scoped `maintenanceTerminal` in contexts where that optional helper is available. Maintenance commands start in `$PI_WEB_DATA_DIR/maintenance`, independently of workspace selection, and do not acquire project/workspace identity. Feature-detect the helper on older hosts. Ordinary workspace commands keep their workspace scope; management-mode authorization remains separate.

### Language packs and compatibility

Feature-detect the optional activation-context `localization` service. Register ICU messages with `localization.registerMessages`, use stable IDs and English fallback messages, and dispose registrations with the plugin lifecycle. Language packs contribute catalogs instead of scanning DOM or injecting HTML. UI language, formatting locale, time zone, and hour cycle are independent; see [Localization](localization.md). The bundled `zh-cn` plugin supplies Chinese ICU catalogs and the legacy `translate` dictionaries. The legacy browser bridge follows the selected UI language, while CLI/server text follows the owning machine's language configuration. Do not translate user/model text, protocol identifiers, or remote-owned payloads.

### Managed package sources

Relays、Workflows 和 Session naming 随 PI WEB 分发及更新，daemon 启动时将已配置来源对齐到当前安装并保留资源过滤器。在“设置 → Pi 包”移除会持久记录；仅执行 `pi remove` 可能在下次 daemon 启动重新安装。

Bundled Relays, Workflows, and Session naming registrations follow the running installation's shipped package paths. Source migration preserves package resource filters and remembered explicit removals. Missing historical global-install sources from either `@jmfederico/pi-web` or `@chainingintention/pi-web-cn` can be repaired to the current installation; unrelated user package sources are not rewritten.

Management resource requests retain management context and authorized workspace scope; a resource URL never grants access beyond that context or falls back to the gateway's ordinary workspace.


<a id="agent-development"></a>
### CSS-first themes

Themes extend the built-in base theme: they can supply layout and control rules as well as palette properties. The base provides the default shell, responsive layout, shared controls, and transcript presentation in the `pi-web-base` cascade layer. Normal unlayered theme rules override those defaults. A supported contract covers conversation, choice, project/workspace/session navigation-row, composer-control, and popup/menu hooks; specialised local component/plugin styles outside that boundary are still being migrated. See [theme architecture](theme-architecture.md) for composition, examples, and current limits.

Declare new themes as static package metadata. A theme-only package ships CSS and assets without browser JavaScript or a server module. The gateway reads themes without evaluating package code and includes its default-theme details and CSS in the initial page. Details include the associated light/dark pair; both variants' CSS are included for Auto. The app can show that palette while a different browser preference loads through an ordinary request. General settings fetch the full inventory once per dialog, with explicit retry on failure and HTTP caching across requests. Built-in palettes use the same declarative mechanism. Optional Custom UI Codex contributes presentation styles and static theme metadata; it does not change the default theme, and Paper / Graphite remain ordinary catalog choices. Defaults, device precedence, and enforcement are described in [configuration](config.md#default-theme-and-streaming).

For example, ship this `package.json` alongside `assets/dark.css` and `assets/light.css`:

```json
{
  "name": "pi-web-ocean-themes",
  "version": "1.0.0",
  "files": ["assets"],
  "piWeb": {
    "plugins": [{
      "id": "ocean-themes",
      "browserRoot": "assets",
      "themes": [{
        "id": "ocean-dark",
        "name": "Ocean Dark",
        "colorScheme": "dark",
        "stylesheets": [{ "id": "palette", "path": "dark.css" }]
      }, {
        "id": "ocean-light",
        "name": "Ocean Light",
        "colorScheme": "light",
        "stylesheets": [{ "id": "palette", "path": "light.css" }]
      }],
      "themePairs": [{
        "id": "ocean",
        "name": "Ocean",
        "light": "ocean-light",
        "dark": "ocean-dark"
      }]
    }]
  }
}
```

Theme and pair declarations require `id` and `name`, and accept optional `description` and finite numeric `order`. Themes also require `colorScheme` (`light` or `dark`) and a nonempty `stylesheets` list. Each stylesheet requires a local `id` and a `path` relative to `browserRoot`, with optional finite numeric `order`. Local IDs begin with a lowercase letter and contain only lowercase letters, digits, dots, or hyphens. Theme and pair IDs must be distinct within an entry; stylesheet IDs must be distinct within each theme. Pair members must reference local themes with matching light/dark schemes.

Keep paths inside the browser-public root, without leading slashes, backslashes, empty segments, `.` or `..` segments. Everything in `browserRoot` is public; ship only intended assets. The gateway supplies qualified theme IDs such as `ocean-themes:ocean-dark` and default/enforced policy. Initial delivery contains only the default selection, or Classic if the initial default is absent from the static catalog (for example, a legacy runtime theme, a disabled plugin, or an unknown ID). This bootstrap fallback preserves the original preference and does not apply to explicit theme queries. `GET api/theme?themeId=…&auto=…` supplies another selection on demand, and General settings use `GET api/themes` for the complete enabled picker inventory. The application HTML embeds the same bootstrap envelope when it is available. The development Vite server obtains that identical envelope server-to-server through `GET`/`HEAD api/theme-bootstrap`; this one route is anonymous because the dev server has no user session. `GET api/theme` and `GET api/themes` remain behind ordinary authentication, and theme CSS keeps ordinary static-resource access. Metadata responses support private HTTP caching with ETag revalidation. It supplies revision-path stylesheet URLs so relative CSS fonts and images use the same immutable asset revision. Keep those assets under the same root, and bundle CSS imports before shipping. Theme-only changes need a browser reload, not a session-daemon restart.

#### Migrating runtime themes

Browser `activate().contributions.themes` and `themePairs` are deprecated but remain supported, with a browser-console deprecation warning. V5 runtime themes still use CSS stylesheet URLs; v4 themes retain their required `tokens: ThemeTokens` contract and cannot declare stylesheet contributions. Existing token palettes continue to work through semantic-property fallbacks, and switching away clears their overrides. Runtime themes require browser activation and cannot benefit from early static discovery.

Move theme and pair metadata into the same entry's `piWeb.plugins[]` declaration. Replace stylesheet `url` expressions with `path` values relative to `browserRoot`, and ship the CSS and referenced assets there. Convert v4 tokens into CSS custom properties. Preserve the plugin ID and local theme/pair IDs to keep saved choices valid, and remove the old runtime registrations rather than registering the same themes twice. Remove `module` only if the browser entry has no other work; remove `serverModule` only if no backend is needed.

Put palette custom properties on `:root` so they inherit into shadow trees; use ordinary selectors in the same file for direct rules in participating roots.

`dark.css` might start with:

```css
:root {
  --pi-bg: #071923;
  --pi-surface: #102b38;
  --pi-text: #e4f5ff;
  --pi-accent: #60d7ee;
}
```

#### Semantic appearance properties

Themes can override these properties independently of the base palette:

| Properties | Purpose |
| --- | --- |
| `--pi-font`, `--pi-mono` | UI and code font-family stacks; control sizes and line heights stay component-owned |
| `--pi-thinking`, `--pi-tool` | Thinking and tool activity tones |
| `--pi-syntax-comment`, `--pi-syntax-keyword`, `--pi-syntax-string`, `--pi-syntax-number`, `--pi-syntax-title`, `--pi-syntax-deletion` | Syntax-highlighting colours, independent of success/warning/error feedback |
| `--pi-chat-conversation-bg`, `--pi-chat-conversation-border` | Ordinary conversation surface and leading edge |
| `--pi-chat-user-bg`, `--pi-chat-user-border` | User-message surface and leading edge |
| `--pi-chat-system-bg` | System-message surface |
| `--pi-chat-activity-bg`, `--pi-chat-compacting-bg` | Session activity and compaction surfaces |

Define these on `:root`, alongside the base palette. Font properties accept font-family stacks, not complete `font` shorthands; keep `--pi-mono` monospaced for code alignment. The terminal's xterm grid and copy-selection overlay retain their configured font so cell geometry stays aligned. Existing themes may omit them: components fall back to base palette colours, existing colour mixes, and system fonts. Built-in themes declare them explicitly; most colours alias or mix base palette properties. Syntax deletions default to `--pi-danger`; the legacy `--pi-error` property remains a fallback for older external themes. Theme properties control appearance; direct CSS rules can also customise migrated base layouts. Components retain interaction and scroll controllers, while the base theme supplies default responsive CSS and visual accessibility treatments. These properties, like shared UI classes, remain experimental.

The example above is a partial palette. Use the [built-in palette files](https://github.com/jmfederico/pi-web/tree/main/pi-web-plugins/themes/assets) as a reference for the shared `--pi-*` vocabulary. `colorScheme` remains required metadata for native controls and browser appearance; declaring CSS alone does not set it. Theme pair `light` and `dark` values are local theme IDs from the same plugin. Auto mode follows the device preference within the pair; unpaired themes stay selected. See [theme selection and defaults](config.md#theme-default-and-device-choices) for device choices, fallback, and the preserved built-in IDs. Machine-bound remote theme contributions remain ignored; themes are app-wide.

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
| 发现规则与诊断 | [插件目录](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/src/server/piWebPluginCatalog.ts) |

当前浏览器与服务端契约均为 **API v5**；宿主继续支持浏览器 **API v4** 和服务端 **API v3**，旧类型名兼容保留。catalog、作用域 backend 及 v5 贡献需使用对应 v5 入口，不将新功能直接塞进旧版本贡献。公开源码契约和已安装声明是签名、验证、限制与生命周期的依据。

- 在 `package.json` 的 `piWeb.plugins` 声明入口，参考独立示例的打包方式；同一包可含多个入口。
- 仅使用公开包入口，内部路由、服务及 `dist/**` 导入不是受支持 API。
- `browserRoot` 尽量窄，里面所有内容都对浏览器公开。包含所需依赖与资产，秘密放在之外。安装插件包限制为 **4,096** 项、**16 MiB**，不计 `.git`/`node_modules`。
- 机器/工作区操作使用宿主帮助方法，插件资产使用模块相对 URL，不硬编码应用路径。
- 面板没有重新挂载时也可能重复渲染。自己管理异步状态，组件生命周期清理连接、计时器与监听器。
- 工作区发现与会话支持功能分离，代理行为放在 Pi 配套扩展，而不是导入宿主内部模块。

<a id="trust-and-recovery"></a>
## Session lifecycle

Plugins can manage a saved session by its full `{ projectId, workspaceId, sessionId }` identity, without selecting it in the browser or opening its runtime. The host resolves the workspace; plugins do not supply session file paths.

Browser v5 invocation contexts expose optional `context.sessions`, bound to that context's machine. Check for its presence on older hosts. Server plugins declare `PI_WEB_HOST_SESSION_LIFECYCLE_CAPABILITY` from `@jmfederico/pi-web/server-plugin-api` in `requires`, then resolve it in `start({ capabilities })`. The capability is local to that daemon and becomes available after workspace providers have settled; workspace providers must not depend on it.

| Method | Effect |
| --- | --- |
| `get(target)` | Read `{ sessionId, pinned, archived }`. |
| `pin(target)` | Persist a pin in the target workspace for an active or archived session. |
| `unpin(target)` | Remove that workspace's pin; pins in other scopes remain in effect. |
| `archive(target)` | Archive that session, without implicitly archiving descendants. |
| `restore(target)` | Restore an archived session without starting its runtime. |
| `delete(target)` | Permanently delete an already-archived session. |

```ts
// In a browser plugin's event handler, using IDs returned by context.catalog:
const sessions = context.sessions;
if (sessions === undefined) throw new Error("This host does not support session lifecycle operations");
const target = { projectId, workspaceId, sessionId };
await sessions.pin(target);
const state = await sessions.get(target);
```

**Pins protect cleanup, not explicit plugin commands.** A plugin can explicitly archive a pinned session or delete it once archived; it does not need to unpin first. Native busy-session and archived-only deletion safeguards still apply. Plugins are trusted code and must decide when to request confirmation for destructive actions. Cleanup previews remain estimates: cleanup rechecks eligibility and pins when it runs, rather than freezing a session list.

Calls accept an optional `{ signal }`. Cancellation or plugin disposal prevents new work; it does not undo a mutation already admitted by the host. Call mutations from event handlers or background work, not render or availability callbacks. Errors are reported to the caller; do not automatically retry a destructive operation after an ambiguous transport failure without checking the current state.

### Pin-storage upgrade

Session pins for navigation and lifecycle are daemon-owned managed state in `$PI_WEB_DATA_DIR/navigation-session-pins.json`. Normal pins and restricted or fully privileged management pins share this store: management scopes are isolated by the verified context's root-user and user IDs, and project/workspace membership is validated. Normal plugin lifecycle, catalog, and cleanup never see management pins, and management invalidations are published only to the matching management event scope. Project and workspace ordering remains unavailable in management mode. Pinned session membership and ordering both come from navigation preferences, not the retired cwd session routes. The old `session-pins.json` and the `/sessions/pins` and `/sessions/:id/pin` routes are retired; new code never reads or writes that file, which stays as a backup and is not auto-converted. When the navigation file is absent, only normal pins are imported from `navigation-preferences.json`. If the old file is navigation-format and the new file does not exist, copy it manually before startup; scoped data requires an explicit mapping decision and must not be renamed or copied into the new schema. Browser pin actions, plugin commands, and cleanup then use the same daemon-owned pins.

Upgrade/restart the web/API process **before** starting the updated session daemon, then reload the browser. Do not keep an older web/API process writing pins after the daemon takes ownership. Managed pins additionally require the `sessions.pins.managementScoped` capability on both web/API and daemon; the gateway rejects an unsupported daemon instead of using the ordinary pin scope. New web/API processes do not fall back to legacy pin writes if the daemon is unavailable or outdated. **Restarting sessiond interrupts active sessions and terminals**; schedule this cutover when they can be interrupted.


普通插件会话生命周期能力不开放管理会话；管理身份、授权和审计边界不因显式 pin/archive/delete 操作而消失。

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
