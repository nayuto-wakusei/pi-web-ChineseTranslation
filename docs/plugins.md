# PI WEB plugin API

PI WEB plugins are trusted browser-side ES modules that extend the PI WEB UI. They are intended for personal, team, and project-local customization, and simple enough for an LLM to create or modify directly.

Plugins can currently:

- add action-palette commands;
- add workspace tools/panels next to Files, Git, and Terminal;
- add compact workspace-label items in the workspace list, panel header, and status bar;
- call browser APIs and documented PI WEB plugin context helpers;
- read workspace files and start workspace terminal commands through documented helpers;
- serve their own static assets from the plugin directory.

They do **not** run in the session daemon, do not get a server-side hook API, and are not sandboxed.

## Pi packages, Pi extensions, and PI WEB plugins

**Pi packages** are distribution bundles managed by Pi (`pi install`, `pi remove`, `pi update`). A Pi package can provide Pi extensions, skills, prompt templates, themes, context/system prompt files, and/or PI WEB browser plugins. Many Pi packages do not include a PI WEB plugin.

**Pi extensions** are runtime modules loaded by the session daemon. They can register Pi tools, hooks, commands, and model providers. They are not PI WEB plugins.

**PI WEB plugins** are browser-side UI modules discovered from bundled, local, dev, and installed Pi-package sources. They cannot register model providers or server-side hooks. Enabling or disabling a PI WEB plugin is a PI WEB config task; installing, removing, or updating a Pi package is a separate Pi package-manager task.

Use **Settings → Pi packages** to view configured Pi packages or install/remove/update a package. Enter only the package source, such as `npm:@scope/package`, a git/URL source, or a local path. PI WEB uses Pi's default package location, equivalent to `pi install <source>`, and does not ask for an install location.

When machine federation is enabled, **Settings → Pi packages** targets the currently selected machine. The panel labels whether changes will run on the local/gateway machine or on a selected remote PI WEB machine. If an older or unavailable remote PI WEB server does not expose package-management routes, PI WEB reports the package management operation as unsupported or unavailable instead of silently falling back to the gateway.

Use **Settings → PI WEB plugins** to enable or disable discovered PI WEB browser plugins before the browser imports them. In a federated setup, this plugin enablement surface targets the currently selected machine and labels where changes are saved. If an older or unavailable remote PI WEB server does not advertise selected-machine settings support, PI WEB reports the plugin settings as unsupported or unavailable instead of silently falling back to the gateway.

After installing, removing, or updating a Pi package, type `/reload` in each idle PI WEB session on the target machine to refresh ordinary Pi resources such as extensions, skills, prompt templates, themes, and context/system prompt files. Reload the browser page separately for newly discovered or changed PI WEB browser plugins. A provider-registering Pi extension follows a separate daemon-start policy; see [Pi extension provider baseline](https://pi-web.dev/config#pi-extension-provider-baseline).

## PI WEB 中的 Pi 扩展对话框

运行在 PI WEB 会话守护进程中的 Pi 扩展可以通过 `ctx.ui.confirm()`、`ctx.ui.select()` 和 `ctx.ui.input()` 向用户提问。PI WEB 会报告 `ctx.hasUI === true`，并且这三种对话框方法确实可用：调用后会在会话记录中以内联方式显示对话框卡片，返回的 Promise 将以用户的实际回答结束，确认框返回布尔值，选择框返回所选项，输入框返回输入文本。

- **可在钩子中使用，不经过提示词队列。** 回答通过独立的会话守护进程通道传递，因此运行中的 `tool_call` 钩子可以安全等待对话框；代理循环会等待钩子，并在收到回答后继续运行。支持在 `tool_call` 钩子中使用对话框进行工具授权确认。
- **启动阶段的对话框可以回答。** 无论创建新会话还是打开已有会话，`session_start` 钩子发起的对话框都能在会话仍在启动时回答；对话框结束后启动流程继续。
- **浏览器刷新后可恢复，最先提交的回答生效。** 浏览器刷新后会根据会话状态重新显示打开的对话框。同一会话打开多个标签页时，最先提交的回答会结束对话框，其他标签页随后显示结束状态。
- **结束状态卡片会保留到用户关闭。** 已回答或已关闭的对话框会在会话记录中保留结果卡片。回答只会传给扩展，因此该卡片是这次交互唯一的可见记录。卡片属于浏览器本地状态：只有见过对话框打开的浏览器会显示它，切换会话或刷新页面后会清除。
- **超时。** 扩展自身的 `timeout` 仍然生效，守护进程还提供 `extensionDialogsTimeoutMs` 安全超时（默认 5 分钟，设为 `0` 时永久等待；见[扩展对话框](https://pi-web.dev/config#extension-dialogs)）。最终期限取两者中较早的时间。没有回答就关闭的对话框会返回对应类型的取消值：确认框为 `false`，选择框和输入框为 `undefined`。
- **中止和运行时替换。** 中止当前运行时，本轮运行中打开的对话框会立即以取消值结束。替换会话运行时（例如 `/reload` 或销毁会话）也会结束所有仍打开的对话框；新运行时的钩子可以重新打开对话框。扩展传入的 `AbortSignal` 同样有效，中止信号会关闭对话框并返回取消值。
- **其他 UI 能力仍为空实现。** 除这三种对话框外，PI WEB 尚未实现 `ExtensionUIContext` 的其他方法（组件、状态、编辑器和 `custom`）。即使 `hasUI` 为 `true`，也不能仅凭它判断这些能力可用。

浏览器本地存在一个限制：新会话仍在创建时刷新页面，会丢失浏览器保存的待启动行，因此对话框卡片会消失。守护进程中的对话框仍会在期限到达时结束，会话创建完成后仍会出现在侧边栏中。

## Trust model

Plugins run as JavaScript in the browser app. Treat them as trusted code:

- they can call browser APIs;
- they can read workspace files and start terminal commands through documented plugin helpers;
- they can render arbitrary Lit templates/custom elements in plugin contribution areas;
- they should not be installed from untrusted sources.

PI WEB's `/api/...` HTTP and WebSocket endpoints are internal implementation details. Plugin code should use the documented context helpers instead. Daring plugins can still reach private routes or runtime objects because they run in the browser, but those private surfaces are experimental: they may graduate into stable helpers, change shape, or disappear.

## What to ask AI to build

Humans should not need to hand-code plugins. Give an AI agent a concrete UI goal and ask it to create or modify a local plugin.

Good plugin requests:

- "Show a workspace badge with the dev server URL from `.env`."
- "Add a workspace panel with links to logs, dashboards, and local services for this repo."
- "Add an action-palette command that starts a standard code-review prompt."
- "Show whether the current workspace is a git worktree, main checkout, staging env, or feature branch."
- "Add a compact status badge based on a project health file or command output saved in the repo."

Copy-paste prompt for creating a plugin:

```text
Build a PI WEB plugin for this project.
Goal: <describe the UI behavior>.
Before coding, read the PI WEB plugin docs:
https://pi-web.dev/plugins
Full API reference:
https://pi-web.dev/plugins.md
Create it as a local plugin under ~/.pi-web/plugins/<plugin-id>.
Use the appropriate extension points from the docs.
Validate by checking /pi-web-plugins/manifest.json and explain how to reload/debug it.
Do not modify PI WEB itself.
```

Copy-paste prompt for modifying a plugin:

```text
Improve the PI WEB plugin at <path>.
Before coding, read the PI WEB plugin docs:
https://pi-web.dev/plugins
Full API reference:
https://pi-web.dev/plugins.md
Keep the plugin compatible with the documented v1 API.
After editing, check the manifest endpoint and browser-console failure cases.
```

## Canonical example: bundled Info plugin

PI WEB ships a real bundled `info` plugin. Use it as the reference example because it is intentionally small while still exercising all core contribution types: an action, a workspace label, and a workspace panel.

Bundled PI WEB plugins are developed as TypeScript in the repository, but their `package.json` metadata still points at built JavaScript because plugins are loaded by the browser as JS ES modules. `npm run dev:web` watches and rebuilds bundled plugin TS into `dist/pi-web-plugins/` during development, and `npm run build` emits the JS before packaging a release.

Source files:

```text
pi-web-plugins/info/package.json
pi-web-plugins/info/pi-web-plugin.ts
pi-web-plugins/info/infoInternals.ts
```

`pi-web-plugin.ts` is the plugin skeleton: metadata plus contribution definitions. `infoInternals.ts` holds everything the bundled panel and action actually render, so you can ignore or replace it when copying the plugin.

Built module:

```text
dist/pi-web-plugins/info/pi-web-plugin.js
```

Package metadata:

```json
{
  "name": "@pi-web/info-plugin",
  "private": true,
  "piWeb": {
    "plugins": [
      { "id": "info", "module": "pi-web-plugin.js" }
    ]
  }
}
```

Module shape excerpt:

```js
export default {
  apiVersion: 2,
  name: "Info Plugin",
  activate: ({ html, svg }) => ({
    contributions: {
      actions: [/* action definitions */],
      workspaceLabels: [/* compact label definitions */],
      workspacePanels: [/* panel definitions using html, optional icons using svg */],
    },
  }),
};
```

When copying the Info plugin, choose a new plugin id so it does not conflict with the bundled `info` plugin.

The Info panel doubles as an always-available PI WEB status view: it renders the host-provided `context.state.piWebStatus` (PI WEB and Pi versions, installation, release state, machine, and workspace details) without issuing its own requests, and its action copies a plain-text diagnostics summary suitable for bug reports.

PI WEB also ships an `updates` plugin that demonstrates dynamic `visible` and `badge` callbacks for tabs that only appear when the host has status messages or needs extra install visibility.

## Local plugin usage

This works with the production native-service install. PI WEB discovers plugins from `~/.pi-web/plugins/<plugin-package>/` on the web/API side; no PI WEB rebuild or session-daemon restart is required. If `PI_WEB_DATA_DIR` is set, use `$PI_WEB_DATA_DIR/plugins` instead.

Symlink a plugin folder into PI WEB's local plugin directory:

```bash
mkdir -p ~/.pi-web/plugins
ln -s /path/to/plugin-folder ~/.pi-web/plugins/plugin-id
```

Reload the PI WEB browser tab. PI WEB serves plugin modules with an mtime-based `?v=` cache buster. After editing a plugin, hard reload the browser if you do not see changes.

## Remote machine plugins

When [machine federation](https://pi-web.dev/machines) is enabled, PI WEB also loads discovered plugins from the selected remote machine. Remote plugins are trusted browser-side code like local plugins, but their contributions are machine-scoped:

- actions, workspace panels, and workspace labels only appear while that machine is selected;
- plugin file and terminal helpers run against that machine;
- plugin code is loaded best-effort through the current gateway and cached for the browser page lifetime;
- if the gateway and remote machine both have an enabled plugin with the same original id, `machineSpecific` metadata decides whether the gateway copy is reused or only the selected machine's copy can appear;
- remote theme contributions are ignored for now because themes are app-wide;
- mixed PI WEB versions across federated machines are best-effort and not guaranteed compatible.

Remote plugin enablement is controlled by the remote machine's PI WEB plugin config. To edit or disable a remote machine plugin, select that machine and use **Settings → PI WEB plugins** when the remote server exposes selected-machine settings, or open that machine directly/update its config file.

Plugin package metadata may set `machineSpecific: true` when the plugin's meaning is tied to the selected PI WEB machine:

- Omitted or `false`: use the gateway copy when the same plugin id is also present on a remote machine. This is best for portable UI plugins whose helpers already route through the selected machine.
- `true`: the gateway copy only appears for the local machine. When a remote machine is selected, only that remote machine's copy can appear; if the remote machine does not expose the plugin, the plugin is hidden. This is best for plugins that report machine-local PI WEB status or depend on machine-local plugin code.

For portable plugin assets, prefer URLs relative to the plugin module, for example:

```js
const url = new URL("./asset.json", import.meta.url);
```

If a remote plugin constructs absolute asset URLs, it should use the `pluginId` from `activate()` because PI WEB gives remote plugins a gateway-scoped runtime id. Hard-coded `/pi-web-plugins/<original-id>/...` URLs may point at the gateway instead of the remote machine.

## Manage PI WEB plugins

Open **Settings → PI WEB plugins** to review discovered bundled, local, dev, and Pi-package-supplied PI WEB plugins for the selected PI WEB machine. When the local machine is selected, this is the gateway plugin list; when a remote machine is selected, the list comes from that remote PI WEB server and includes disabled discovered plugins it exposes. PI WEB can disable any discovered selected-machine plugin before the browser imports it. Core app contributions such as the built-in command palette, base workspace tools, and themes are not managed through this plugin list.

This surface is only for PI WEB plugin enablement. To install, remove, or update Pi packages that may provide PI WEB plugins or other Pi resources, use **Settings → Pi packages**. In a federated setup, both the Pi packages panel and the PI WEB plugins panel target the selected machine; plugin enablement still writes the PI WEB `plugins` config key rather than changing Pi package-manager settings.

Plugin preferences are stored under the top-level `plugins` config key in the PI WEB config file:

```json
{
  "plugins": {
    "workspace-tasks": {
      "enabled": true,
      "settings": {}
    },
    "info": {
      "enabled": false
    }
  }
}
```

Plugins are enabled by default. Set `enabled` to `false` to remove a plugin from `/pi-web-plugins/manifest.json` so the browser will not import or activate it on the next page load. The optional `settings` object is reserved for plugin-specific settings.

After changing plugin enablement, reload the PI WEB browser tab. Already-loaded plugin JavaScript is not unloaded from the current page.

## Built-in plugins

PI WEB ships core, discoverable plugins in the main `@chainingintention/pi-web-cn` npm package. Updates and Workspace Tasks are loaded directly from the PI WEB package. Relays is shipped as a real Pi package and installed automatically for the active agent profile, so it also requires no manual `pi install` step.

Built-in plugins can be managed from **Settings → PI WEB plugins** or with the top-level `plugins` config key.

### Updates

**Plugin id:** `updates`
**What it does:** adds a conditional **Updates** workspace tab with PI WEB update, restart, and installed-service guidance, plus a **Check for PI WEB Updates** action for the selected machine.

While a browser tab is connected, PI WEB refreshes the selected machine's status every 15 minutes. npm release lookups are cached on that machine for six hours, so the automatic refresh normally contacts npm at most once in that window. Run **Check for PI WEB Updates** from the action palette to bypass both caches and check immediately. Operator settings that skip remote version checks, such as `PI_WEB_OFFLINE`, are still respected.

Updates is enabled by default. It declares `machineSpecific: true` so the gateway Updates tab and action only appear for the local machine; while a remote machine is selected, that remote machine's Updates plugin is used if available. To hide it, disable `updates` in **Settings → PI WEB plugins** or set:

```json
{
  "plugins": {
    "updates": { "enabled": false }
  }
}
```

### Workspace Tasks

**Plugin id:** `workspace-tasks`
**Config file:** `.pi-web/tasks.json`
**What it does:** adds a **Tasks** workspace tab for running configured shell commands in dedicated PI WEB terminals.

Workspace Tasks is enabled by default. To hide it, disable `workspace-tasks` in **Settings → PI WEB plugins** or set:

```json
{
  "plugins": {
    "workspace-tasks": { "enabled": false }
  }
}
```

Configure workspace tasks in `.pi-web/tasks.json`:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "app.start",
      "title": "Start app",
      "group": "Development",
      "description": "Start the local development server.",
      "command": "npm run dev"
    },
    {
      "id": "db.reset",
      "title": "Reset DB",
      "group": "Database",
      "command": "go -C klingit-go run ./cli db reset",
      "confirm": true
    }
  ]
}
```

Open a workspace, choose the **Tasks** tab, and click **Run** next to a task. Commands run in the workspace root because PI WEB creates the terminal for that workspace.

Task fields:

- `version`: must be `1`.
- `tasks`: array of task definitions.
- `id`: stable task id, matching `^[a-z][a-z0-9.-]*$`.
- `title`: button label.
- `command`: literal shell command sent to the terminal.
- `description`: optional explanatory text.
- `group`: optional group heading.
- `confirm`: optional boolean. When true, the browser asks before dispatching the command.

Review task configs before running them, especially in shared projects. Workspace Tasks runs trusted shell commands from your repositories.

### Relays

**Plugin id:** `relays`
**What it does:** adds a read-only **Relays** workspace tab for browsing the workspace's relays, plus an **Open Workspace Relays** action for the selected workspace that opens the same tab.

A relay is a directory of markdown notes under `.pi-web/relays/<name>/` in the workspace root — the convention used by the Relay method for chaining agent sessions. The tab lists each relay's documents with `status.md`, `charter.md`, and `log.md` first (in that order), followed by any other files alphabetically, and opens `status.md` by default. Markdown documents render as sanitized HTML; other files render as preformatted text, and binary files have no preview. Truncated documents show a notice, and **Refresh** re-scans the workspace and reloads the open document.

Documents in subfolders are listed too. Folders appear as chips in the document strip, and expanding one inserts its files inline after it. Expanding a folder collapses its siblings at the same level, while collapsing the folder that contains the open document keeps the selection and highlights that folder. Relay trees deeper than five levels, larger than 200 documents, or containing more than 50 folders are listed partially with a notice.

With several relays, a picker pre-selects the most recently modified one; a single relay opens directly. A workspace without `.pi-web/relays/` shows an empty state explaining the convention. The tab never creates, edits, or deletes relay files.

Relays is shipped as the `@jmfederico/pi-relay` Pi package. On session-daemon startup, PI WEB installs the shipped package for the active agent profile when it is not already configured. This best-effort install never blocks daemon startup. Removing the package through **Settings → Pi packages** records that choice for the profile, so later startups do not add it back; the same panel offers a one-click install suggestion when you want it again.

Once installed, the browser plugin is enabled by default. To hide its browser UI without removing the Pi package, disable `relays` in **Settings → PI WEB plugins** or set:

```json
{
  "plugins": {
    "relays": { "enabled": false }
  }
}
```

## Discovery and packaging

PI WEB builds the gateway `/pi-web-plugins/manifest.json` from these sources:

1. Bundled plugins in the PI WEB package:

   ```text
   pi-web-plugins/<plugin-package>/
   ```

2. User-local plugins:

   ```text
   ~/.pi-web/plugins/<plugin-package>/
   ```

   Entries may be real directories or symlinks. This is the recommended development workflow.

3. Installed Pi packages that expose PI WEB plugin metadata. Pi packages may be user or project scoped. Installing/removing/updating Pi packages is done from **Settings → Pi packages** (or Pi's package manager), not from the PI WEB plugin enable/disable list.

Remote machines expose their own manifests through the gateway at `/api/machines/<machine-id>/pi-web-plugins/manifest.json`. Those plugin modules are rewritten to gateway-scoped asset URLs and registered under machine-scoped runtime ids so duplicate plugin ids on different machines do not collide.

Plugin package directory names and plugin ids must be valid identifiers:

```text
^[a-z][a-z0-9.-]*$
```

A package can expose one or more PI WEB plugin modules. There is exactly one supported `package.json` metadata shape:

```json
{
  "private": true,
  "piWeb": {
    "plugins": [
      { "id": "review", "module": "dist/review.js" },
      { "id": "dashboard", "module": "dist/dashboard.js", "machineSpecific": true }
    ]
  }
}
```

Rules:

- `piWeb.plugins` must be an array of objects.
- Each entry must have an explicit `id` and `module`.
- `id` must match `^[a-z][a-z0-9.-]*$`.
- `module` must be a safe relative path inside the plugin package root.
- `machineSpecific` is optional and must be a boolean; omit it for the default portable gateway behavior.
- Duplicate plugin ids are not auto-renamed; later duplicates are skipped.
- Legacy shortcuts such as `piWeb.plugin`, string entries in `piWeb.plugins`, `piWeb.id` fallback ids, and no-`package.json` fallbacks are not supported.

### Manifest and assets

The manifest contains each discovered plugin module. Current PI WEB releases emit `module` as a leading application-root reference:

```json
{
  "plugins": [
    {
      "id": "my-plugin",
      "module": "/pi-web-plugins/my-plugin/pi-web-plugin.js?v=1234567890",
      "source": "local",
      "scope": "local",
      "machineSpecific": false
    }
  ]
}
```

The browser maps leading application-root references into the current application base, so the same manifest works at the origin root or under a reverse-proxy path prefix. Keeping this output format also lets gateways from existing PI WEB releases consume plugins from an upgraded remote machine. For compatibility, federated gateways additionally accept explicit manifest-relative references such as `./my-plugin/pi-web-plugin.js` and legacy plugin-root-relative references such as `nested/pi-web-plugin.js`; all accepted forms are rewritten to deployment-portable, gateway-relative references.

`source` describes where the plugin came from (`bundled`, `local`, or the Pi package source). `scope` is `bundled`, `local`, `user`, or `project`. `machineSpecific` controls whether the gateway copy is valid for remote machines or only each selected machine's own copy can appear.

At an origin-root deployment, a plugin's static assets are available under:

```text
/pi-web-plugins/<plugin-id>/<path-inside-plugin-root>
```

Prefer module-relative asset URLs so they also work for remote machine plugins. For example, a built plugin module can reference an SVG shipped beside it:

```js
const iconUrl = new URL("./assets/icon.svg", import.meta.url);
```

The final installed plugin package must contain `assets/icon.svg` at that path relative to the final built module. PI WEB serves files that already exist in the package; it does not copy a source `public/` directory or apply Vite-style public-directory semantics. Configure the plugin build and package contents to emit or copy the asset into its final module-relative location.

PI WEB prevents asset path traversal outside the plugin root. JavaScript, JSON, CSS, HTML, and SVG files get appropriate content types; unknown file types are served as octet-stream.

## Plugin module shape

The entry module must default-export a plugin object:

```ts
interface PiWebPlugin {
  apiVersion: 2;
  name: string;
  activate: (context: PluginActivationContext) => PluginActivationResult;
}

interface PluginActivationContext {
  apiVersion: 2;
  pluginId: string;
  runtimePluginId?: string;
  html: typeof import("lit").html;
  svg: typeof import("lit").svg;
}

interface PluginActivationResult {
  contributions: PluginContributions;
}
```

Example:

```js
export default {
  apiVersion: 2,
  name: "My Plugin",
  activate: ({ pluginId, html }) => ({
    contributions: {
      actions: [],
      workspacePanels: [],
      workspaceLabels: [],
    },
  }),
};
```

`activate()` is called once when the UI loads the plugin. Keep it cheap: define contributions there, but move expensive or async work into actions, custom elements, or explicit user interactions.

Browser API v2 is a deliberate compatibility break. PI WEB rejects browser API v1 modules instead of silently adapting them. Migrate by setting `apiVersion: 2`, using `pluginId` for the stable package/provider identity, and using `runtimePluginId` when a host-qualified contribution id is required. The former `@chainingintention/pi-web-cn/plugin-api/unstable` path is no longer exported; rely on the documented stable helpers instead.

The plugin id comes from `package.json`, not from the JavaScript module. Contribution ids are local to the plugin and PI WEB qualifies them internally as:

```text
<plugin-id>:<local-contribution-id>
```

For example, plugin `info` with action `workspace.show-path` becomes `info:workspace.show-path`.

## Contributions

`activate()` returns a `contributions` object with any combination of these arrays:

```ts
interface PluginContributions {
  actions?: PluginAction[];
  workspacePanels?: WorkspacePanelContribution[];
  workspaceLabels?: WorkspaceLabelContribution[];
}
```

### Actions

Actions appear in the action palette. They can inspect app state and call UI/runtime helpers.

```js
actions: [
  {
    id: "copy-diagnostics",
    title: "Copy PI WEB Diagnostics",
    description: "Copy version, installation, and status details for this machine",
    group: "Info",
    run: async (context) => {
      const version = context.state.piWebStatus?.components.web.runtimeVersion ?? "unknown";
      await navigator.clipboard.writeText(`PI WEB ${version}`);
    },
  },
]
```

Action type:

```ts
interface PluginAction {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  group?: string;
  enabled?: (context: PluginRuntimeContext) => boolean;
  disabledReason?: (context: PluginRuntimeContext) => string | undefined;
  run: (context: PluginRuntimeContext) => void | Promise<void>;
}
```

If an action is disabled and returns `disabledReason`, PI WEB can keep it visible in the action palette with that explanation instead of hiding it.

Stable runtime context fields:

```ts
interface PluginRuntimeContext {
  state: {
    selectedMachine?: PluginMachine;
    selectedWorkspace?: Workspace;
    selectedSession?: unknown;
    piWebStatus?: PiWebStatusResponse;
  };
  prompt: PluginPromptEditor;
  openActionPalette: () => void;
  focusPrompt: () => void;
  addProject: () => void | Promise<void>;
  configureAuth: () => void | Promise<void>;
  logoutAuth: () => void | Promise<void>;
  selectWorkspaceTool: (tool: QualifiedContributionId) => void;
  openTerminal: (options?: { terminalId?: string }) => void;
  refreshFiles: () => void | Promise<void>;
  refreshGit: () => void | Promise<void>;
  checkForPiWebUpdates?: () => void | Promise<void>;
  startSession: () => void | Promise<void>;
  archiveSession: () => void | Promise<void>;
  stopActiveWork: () => void | Promise<void>;
}
```

Notes:

- `state` is a snapshot of current UI state when actions are built.
- The stable state fields are `state.selectedMachine`, `state.selectedWorkspace`, `state.selectedSession`, and `state.piWebStatus`. `state.selectedMachine` identifies the currently selected machine. `state.piWebStatus` describes the currently selected machine's PI WEB runtime, or the gateway/local runtime when the local machine is selected.
- Other `state` fields may exist at runtime, but they are private PI WEB internals that may graduate into stable helpers, change shape, or disappear.
- `enabled` is evaluated when the action palette asks for actions.
- `selectWorkspaceTool()` expects a qualified panel id such as `my-plugin:workspace.info`.
- `openTerminal()` switches to the built-in terminal panel. Pass `{ terminalId }` to deep-link to a specific terminal.
- Only fields documented here and declared in `plugin-api.d.ts` are stable public browser plugin API. Runtime-only fields and private HTTP routes are not compatibility surfaces.

### Prompt editor API

The `prompt` helper on `PluginRuntimeContext` and `WorkspacePanelContext` provides stable access to the chat prompt editor:

| Method | Description |
| --- | --- |
| `insertText(text)` | Insert text at cursor position. When text is selected, replaces the selection. Focuses the editor first if not focused. |
| `getText()` | Returns the full prompt text. |
| `getSelection()` | Returns `{ start, end, text }` if text is selected, or `null`. |

Usage:

```js
// Insert text at the cursor (e.g. a file mention)
context.prompt.insertText("@file.txt");

// Read the current prompt and selection
const text = context.prompt.getText();
const selection = context.prompt.getSelection(); // { start, end, text } | null
```

Use `focusPrompt()` on `PluginRuntimeContext` to move focus to the prompt editor. Workspace panels can call `context.prompt.insertText()` from explicit user interactions such as button clicks; panel contexts target the currently selected session's mounted prompt editor.

#### Keyboard shortcuts

- App-level keyboard shortcuts must be attached to actions. PI WEB does not support standalone plugin keyboard commands; contribute an action first, then add a `shortcut` if it needs a keybinding.
- `shortcut` is the action's default keybinding. It is displayed in the action palette and handled by the global shortcut dispatcher when the action is enabled.
- Use modified shortcuts such as `mod+shift+p`; plain letter shortcuts are intentionally ignored so normal typing is never captured.
- Future PI WEB versions may allow users to override or disable action shortcuts by action id, so plugins should treat `shortcut` as a default rather than a guaranteed final binding.
- Choose shortcuts carefully to avoid conflicts. There is no user-facing shortcut override or conflict resolver yet.
- Local text input, terminal input, list navigation, and dialog keys such as Enter, Escape, and arrow keys do not need to be plugin actions unless they are app-level commands.

### Workspace panels

Workspace panels add tools next to built-in workspace tools. They render inside the workspace side panel on desktop and as mobile tabs on smaller screens.

```js
workspacePanels: [
  {
    id: "workspace.info",
    title: "Info",
    icon: svg`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 10v6"></path>
        <path d="M12 7h.01"></path>
      </svg>
    `,
    order: 100,
    visible: ({ workspace }) => workspace.isGitRepo,
    render: ({ workspace }) => html`
      <section class="toolbar"><strong>Info</strong></section>
      <section class="viewer">
        <p class="muted">${workspace.label}</p>
        <p class="muted">${workspace.path}</p>
      </section>
    `,
  },
]
```

Panel type:

```ts
interface WorkspacePanelContribution {
  id: string;
  title: string;
  icon?: TemplateResult;
  order?: number;
  visible?: (context: WorkspacePanelContext) => boolean;
  badge?: (context: WorkspacePanelContext) => string | number | TemplateResult | undefined;
  render: (context: WorkspacePanelContext) => TemplateResult;
}

interface WorkspacePanelContext {
  machine: PluginMachine;
  workspace: Workspace;
  state?: PluginRuntimeState;
  files: {
    readFile(path: string): Promise<FileContentResponse>;
    listFiles(path: string): Promise<FileTreeResponse>;
    writeFile(path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions): Promise<WriteWorkspaceFileResponse>;
    deleteFile(path: string): Promise<DeleteWorkspaceFileResponse>;
    moveFile(fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions): Promise<MoveWorkspaceFileResponse>;
  };
  prompt: PluginPromptEditor;
  terminal: {
    open(options?: { terminalId?: string }): void;
    runCommand(input: {
      title: string;
      command: string;
      metadata?: Record<string, string>;
      open?: boolean;
    }): Promise<TerminalCommandRunHandle>;
  };
  host: {
    requestRender(): void;
  };
}
```

`icon` is optional and is used in the compact mobile tab bar. Prefer an SVG rendered with the `svg` helper from `PluginActivationContext`; use `currentColor` so PI WEB themes can style it. If `icon` is omitted, mobile tabs fall back to initials from the panel title, or to the full title when initials collide.

`machine`, `workspace`, `files`, `prompt`, `terminal`, and `host` are documented as stable for panel callbacks. The `files` helper supports `readFile`, `listFiles`, `writeFile`, `deleteFile`, and `moveFile` — see [Reading workspace files](#reading-workspace-files), [Listing workspace files](#listing-workspace-files), and [Writing workspace files](#writing-workspace-files). The `prompt` helper supports panel interactions that insert workspace context into the current prompt — see [Prompt editor API](#prompt-editor-api). Use `terminal.open()` to switch to the built-in terminal panel; pass `{ terminalId }` to deep-link to a specific terminal. Call `host.requestRender()` when async plugin-owned state changes should make PI WEB re-evaluate panel callbacks such as `badge`, `visible`, or `render`.

For compatibility, PI WEB still provides the old `context.openTerminal()` workspace-panel helper at runtime. It is deprecated, intentionally omitted from the public TypeScript declarations, and planned for removal in v2. Existing JavaScript plugins keep working, while typed plugins should migrate to `context.terminal.open()`.

Useful workspace and machine shapes:

```ts
interface PluginMachine {
  id: string;
  name: string;
  kind: "local" | "remote";
}

interface Workspace {
  id: string;
  projectId: string;
  path: string;
  label: string;
  branch?: string;
  isMain: boolean;
  isGitRepo: boolean;
  isGitWorktree: boolean;
}
```

`machine.id` is included in panel contexts so plugins can keep caches machine-scoped. Do not infer the selected machine from global browser state.

Use existing classes such as `toolbar`, `viewer`, `empty`, and `muted` for panel content when possible. Do not assume a panel owns the whole page; keep layout contained.

### Workspace labels

Workspace labels add compact inline metadata wherever PI WEB displays a workspace label: workspace list, workspace panel header, and status bar.

Use them for short facts like project environment, local URL, branch status, container name, or health state.

```js
workspaceLabels: [
  {
    id: "dev-url",
    order: 10,
    visible: ({ workspace }) => workspace.path.includes("my-app"),
    items: () => [{
      type: "link",
      text: "web:5173",
      href: "http://localhost:5173",
      title: "Open dev server",
      target: "_blank",
    }],
  },
]
```

Label contribution type:

```ts
interface WorkspaceLabelContribution {
  id: string;
  order?: number;
  visible?: (context: WorkspaceLabelContext) => boolean;
  items: (context: WorkspaceLabelContext) => WorkspaceLabelItem[];
}

interface WorkspaceLabelContext {
  machine: PluginMachine;
  workspace: Workspace;
  state?: PluginRuntimeState;
  files: {
    readFile(path: string): Promise<FileContentResponse>;
    listFiles(path: string): Promise<FileTreeResponse>;
    writeFile(path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions): Promise<WriteWorkspaceFileResponse>;
    deleteFile(path: string): Promise<DeleteWorkspaceFileResponse>;
    moveFile(fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions): Promise<MoveWorkspaceFileResponse>;
  };
  host: {
    requestRender(): void;
  };
}
```

`machine`, `workspace`, `files`, and `host` are documented as stable for label callbacks. The `files` helper supports `readFile`, `listFiles`, `writeFile`, `deleteFile`, and `moveFile` — see [Reading workspace files](#reading-workspace-files), [Listing workspace files](#listing-workspace-files), and [Writing workspace files](#writing-workspace-files). Include `machine.id` in any label caches that depend on workspace data. Call `host.requestRender()` when async plugin-owned state changes should make PI WEB re-evaluate label `visible` or `items` callbacks.

Items are sorted by `order` and then id. Return an empty array to render nothing. Keep callbacks synchronous and lightweight; start async work from the callback, return cached items, then call `host.requestRender()` when the cache changes.

#### Text items

```js
{ type: "text", text: "staging", title: "Staging workspace" }
```

#### Link items

```js
{
  type: "link",
  text: "web:5173",
  href: "http://localhost:5173",
  title: "Open dev server",
  target: "_blank"
}
```

PI WEB renders the anchor and adds safe defaults such as `rel="noopener noreferrer"` for `_blank` links. `javascript:` and `data:` links are rendered as plain text instead of links.

#### Render items

Use render items when a label contribution needs custom UI, async data, or caching. Render items should stay compact and inline.

```js
class MyWorkspaceBadge extends HTMLElement {
  set workspace(value) {
    this._workspace = value;
    this.textContent = value?.branch === "main" ? "main" : "branch";
  }
}

if (!customElements.get("my-workspace-badge")) {
  customElements.define("my-workspace-badge", MyWorkspaceBadge);
}

export default {
  apiVersion: 2,
  name: "My Plugin",
  activate: ({ html }) => ({
    contributions: {
      workspaceLabels: [
        {
          id: "badge",
          order: 10,
          items: ({ workspace }) => [{
            type: "render",
            render: () => html`<my-workspace-badge .workspace=${workspace}></my-workspace-badge>`,
          }],
        },
      ],
    },
  }),
};
```

## Reading workspace files

Workspace panels and workspace labels can read files through the documented `files` helper. PI WEB binds this helper to the callback's machine and workspace, so it works the same for local and federated machines.

```js
workspacePanels: [
  {
    id: "workspace.env",
    title: "Env",
    render: ({ files }) => html`
      <my-env-viewer .files=${files}></my-env-viewer>
    `,
  },
]

class MyEnvViewer extends HTMLElement {
  set files(value) {
    this._files = value;
    void this.load();
  }

  async load() {
    try {
      const file = await this._files.readFile(".env.example");
      this.textContent = file.binary ? "Binary file" : file.content;
    } catch (error) {
      this.textContent = error instanceof Error ? error.message : String(error);
    }
  }
}
```

Labels should use the same helper through a plugin-owned cache because `items()` itself must return synchronously:

```js
const envCache = new Map();

function envKey(machine, workspace) {
  return `${machine.id}:${workspace.id}:.env.local`;
}

function loadEnvLabel(context) {
  const key = envKey(context.machine, context.workspace);
  const cached = envCache.get(key);
  if (cached !== undefined) return cached;

  const pending = { status: "loading", label: undefined };
  envCache.set(key, pending);
  context.files.readFile(".env.local")
    .then((file) => {
      pending.status = "ready";
      pending.label = file.content.match(/^DEV_URL=(.+)$/m)?.[1];
      context.host.requestRender();
    })
    .catch(() => {
      pending.status = "missing";
      context.host.requestRender();
    });
  return pending;
}

workspaceLabels: [
  {
    id: "dev-url",
    items: (context) => {
      const cached = loadEnvLabel(context);
      return cached.label === undefined ? [] : [{
        type: "link",
        text: cached.label,
        href: cached.label,
        target: "_blank",
      }];
    },
  },
]
```

The file response includes fields such as `path`, `content`, `truncated`, and `binary`. Be careful with sensitive files such as `.env`: plugins are trusted browser code, and file contents are exposed to the plugin.

## Listing workspace files

`files.listFiles(path)` lists the entries of a workspace directory. Pass `""` for the workspace root. Like `readFile`, PI WEB binds the call to the callback's machine and workspace, so it works the same for local and federated machines.

```js
const listing = await context.files.listFiles("src");
for (const entry of listing.entries) {
  // entry: { name, path, type: "file" | "directory" | "symlink", size?, modifiedAt? }
}
```

The listing response includes `path`, `entries`, `scannedAt`, and `truncated`. When `truncated` is true, the server cut the listing short, so treat the entries as partial.

`listFiles` rejects when the directory does not exist or cannot be read, matching `readFile` error behavior. When a directory is optional, catch the error and treat it as an empty listing:

```js
async function listSubdirectoryNames(context, path) {
  try {
    const listing = await context.files.listFiles(path);
    return listing.entries.filter((entry) => entry.type === "directory").map((entry) => entry.name);
  } catch {
    return [];
  }
}
```

## Writing, deleting, and moving workspace files

Workspace panels and workspace labels can write, delete, and move files through the documented `files` helper. Like `readFile`, PI WEB binds these helpers to the callback's machine and workspace, so they work the same for local and federated machines.

### Writing files

```js
workspacePanels: [
  {
    id: "workspace.generate",
    title: "Generate",
    render: ({ files }) => html`
      <button @click=${async () => {
        const result = await files.writeFile("output/result.txt", "Generated content\n");
        console.log("Wrote", result.path, result.size, "bytes");
      }}>Generate</button>
    `,
  },
]
```

### Binary writes

Pass a `Uint8Array` for binary content such as images:

```js
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
await files.writeFile("screenshots/thumb.png", png);
```

### Options

`files.writeFile` accepts an optional third argument:

- `createDirs` (default `true`): create intermediate directories, like `mkdir -p`.
- `overwrite` (default `true`): overwrite existing files. Set to `false` to throw if the file already exists.

```js
// Create only — throw if the file already exists
await files.writeFile("config/new-config.json", jsonContent, { overwrite: false });
```

### Deleting files

`files.deleteFile` removes a workspace file. It is idempotent: deleting a file that does not exist returns `{ existed: false }` instead of throwing.

```js
const result = await files.deleteFile("temp/cache.json");
console.log(result.existed ? "File deleted" : "File did not exist");
```

### Moving files

`files.moveFile` renames or moves a file within the workspace, like `mv`. The default is safe: it will not overwrite an existing target file.

```js
// Rename a file
await files.moveFile("old-name.txt", "new-name.txt");

// Move into a subdirectory (creates intermediate dirs by default)
await files.moveFile("file.txt", "archive/file.txt");

// Overwrite an existing target
await files.moveFile("incoming.txt", "current.txt", { overwrite: true });

// Move without creating intermediate directories
await files.moveFile("file.txt", "deep/nested/file.txt", { createDirs: false }); // throws if dirs don't exist
```

`files.moveFile` accepts an optional third argument:

- `createDirs` (default `true`): create intermediate directories for the target path.
- `overwrite` (default `false`): overwrite the target file if it exists. The default is safer than `writeFile` because moving is a more destructive operation.

### Error handling

All file mutations share the same safety layer:

- `overwrite: false` on `writeFile` or existing target on `moveFile` (default) throws if the file already exists.
- Path traversal (e.g., `../../etc/passwd`) is blocked by the workspace safety layer.
- Writing to or moving to a path that is a directory returns an error.
- Deleting a directory returns an error.
- Intermediate directory creation with `createDirs: false` fails if the parent directory does not exist.

After any mutation (`writeFile`, `deleteFile`, or `moveFile`), the File Explorer updates automatically. No explicit `refreshFiles()` call is needed from plugin code. For label and badge updates, call `context.host.requestRender()` if the UI should reflect the change.

### Security

Plugins are trusted browser code. File writes go through the same path safety validation as reads — paths are resolved and checked to stay inside the workspace root.

## Running workspace terminal commands

Workspace panels can start terminal commands through the documented `terminal` helper. Commands run in the current workspace on the panel's machine.

```js
render: ({ terminal }) => html`
  <button @click=${() => terminal.runCommand({
    title: "Build",
    command: "npm run build",
    open: true,
    metadata: { "my-plugin.task": "build" },
  })}>Build</button>
`
```

Review command strings carefully. They are trusted shell commands executed in the workspace terminal.

## Private and experimental PI WEB APIs

PI WEB's `/api/...` HTTP and WebSocket routes and runtime-only fields are private implementation details. They exist because plugins are trusted browser code, and because some capabilities may be evaluated there before they are designed as stable helpers.

The stable browser API is the documented helper surface and the type-only `@chainingintention/pi-web-cn/plugin-api` export. The stable server API is the separate type-only `@chainingintention/pi-web-cn/server-plugin-api` export. The former browser `plugin-api/unstable` entry is not part of API v2 and is no longer exported. Code that deliberately depends on another private runtime surface must keep that dependency local and expect to revisit it after PI WEB upgrades.

## Async data and caching

PI WEB does not provide a plugin cache/invalidation framework. Keep host callbacks cheap:

- simple contributions should be synchronous and cheap;
- expensive or async work should live inside the plugin;
- custom elements in `type: "render"` label items or panels are a good place to own async loading;
- dedupe async reads/commands and avoid unbounded polling;
- clean up intervals/event listeners in custom elements' `disconnectedCallback()`.

## Agent implementation checklist

If you are an AI agent building or editing a PI WEB plugin, follow this checklist:

1. Create or update a plugin folder with `package.json` and a JavaScript module such as `pi-web-plugin.js`.
2. Use the single supported package metadata shape: `piWeb.plugins` array with `{ id, module, machineSpecific? }` entries.
3. Default-export `{ apiVersion: 2, name, activate }` from a browser module. Server modules use server-plugin API v1.
4. Return `{ contributions: { actions, workspacePanels, workspaceLabels } }` from `activate()`.
5. Use ids matching `^[a-z][a-z0-9.-]*$`.
6. Use the activation context's `html` function for Lit templates.
7. Keep `activate()` synchronous and cheap; return contribution definitions only.
8. Add actions for command-palette operations.
9. Add workspace panels for larger workspace UI.
10. Add workspace labels for compact inline metadata.
11. Return arrays from workspace label `items()`; return an empty array to render nothing.
12. Use documented context helpers first: `files`, `terminal`, `host.requestRender`, `workspace`, `machine`, `state.selectedWorkspace`, `state.selectedSession`, `state.piWebStatus`, and `prompt`.
13. Do not fetch PI WEB `/api/...` endpoints directly unless you intentionally accept private API churn; prefer documented helpers such as the paired workspace `backend` bridge.
14. Treat plugins as trusted code and avoid reading or displaying secrets unless intentional.
15. After local edits, tell the user to hard reload the browser and check the console for plugin errors.

## Troubleshooting

Check discovery:

```bash
curl http://127.0.0.1:8504/pi-web-plugins/manifest.json
```

Check a plugin module:

```bash
curl http://127.0.0.1:8504/pi-web-plugins/my-plugin/pi-web-plugin.js
```

Common issues:

- invalid plugin id or contribution id;
- missing default export;
- missing browser `apiVersion: 2`, `name`, or `activate` function;
- missing `package.json` or incorrect `piWeb.plugins` metadata;
- legacy shortcuts such as `piWeb.plugin`, string plugin entries, or no-`package.json` fallback;
- duplicate plugin ids; later duplicates are skipped rather than renamed;
- entry module path points outside the plugin root or file does not exist;
- browser cache not refreshed after editing;
- plugin directory is not under `~/.pi-web/plugins` or symlinked there;
- plugin throws during module import, `activate()`, `visible()`, `enabled()`, `items()`, or `render()`; check the browser console.
