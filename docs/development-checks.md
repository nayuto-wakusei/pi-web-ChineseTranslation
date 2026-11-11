# 开发与交付检查

开发时优先验证应用行为；编译、公开声明和打包使用独立的交付门槛。

## 开发阶段

先运行与改动相关的最小测试：

```sh
npm test -- src/shared/themePreference.test.ts
```

跨模块改动合并前运行：

```sh
npm run verify
```

该命令包含类型检查、lint、未使用代码分析和普通测试。参考[测试政策](testing.md)选择能够证明行为的最小边界，使用[测试夹具](testing-harnesses.md)查具体机制。优先复用、精简或合并现有覆盖；只有确有保护缺口才新增，不为形式完整堆叠用例。

按 import 选择相关测试不能覆盖所有运行时读取的文件。文档、Docker 资产、包清单和生成产物改动还需显式选择所属检查；空测试集不是通过。本地提交钩子仍使用 `verify:staged`，不以仅 whitespace 检查代替。

大规模暂存路径超过安全命令行长度预算时，钩子自动改用全量 lint/test，并继续保留 typecheck 与 knip 门禁。

弹层、聊天滚动、命中区域和焦点组合需要[隔离浏览器用例](../test-fixtures/browser/)验证真实布局；DOM 单元测试负责事件和状态，不能证明浏览器几何。文档改动先核对链接、路径及相关静态资产，再检查差异；不把某个平台的跳过写成通过。

Windows 上的真实 bash 工具测试可通过 `PI_WEB_TEST_BASH` 指定已安装的 Git Bash；该变量仅供测试 fixture 使用，不修改服务或用户配置。全量检查建议限制 worker，避免冷启动子进程及大目录扫描争抢资源：

```powershell
$env:PI_WEB_TEST_BASH = 'D:\Program Files\Git\bin\bash.exe'
$env:VITEST_MAX_WORKERS = '4'
npm run verify
```

## 开发启动

`package.json` 持有开发服务的前置条件与 npm 生命周期；启动服务应走 npm，让 pre/main/post 顺序执行，前置失败不得启动。`npm run dev` 监督 watched sessiond、Web/API 和 client；`npm run dev:ui` 只监督 Web/API 与 client。拆分原生及 Docker 服务使用非 watched 的 `start:sessiond` 和 UI 组 `dev:ui`，不把 daemon 纳入 UI 自动重载。

旧原生服务定义继续运行原有 shell 分组；需要采用共享监督时，在更新后的 checkout 执行一次 `pi-web install --dev`，自定义配置须带原来的 `--config`。重装服务会中断会话与终端；更新/重启命令不重写定义，doctor 提示需重装的旧定义。Docker 更新通过 recreate 应用新定义。具体进程边界见[运维](admin/operations.md)，网站单独发布见[网站部署](website-deployments.md)。

## CI 与平台范围

CI 将静态检查、Linux 普通测试、Windows 原生边界子集、Linux 包与运行时检查、隔离浏览器用例拆成独立任务。Windows 使用 `npm run test:windows` / `vitest.windows.config.ts`，重点覆盖真实文件系统、进程启动、模块加载和本地 transport；不因测试提及 Windows 就重复纯逻辑或 DOM 用例。Linux 仍运行完整普通测试；构建先于消费产物的检查。精确流程以仓库 workflow 为准，不把本地定向通过称为 CI 或全量通过。

<a id="web-ui-performance"></a>
## Web UI 性能比较

使用隔离浏览器夹具比较聊天更新、会话切换、大量会话导航、真实滚动及 200 条结果的搜索对话框渲染，不连接真实模型或修改用户项目。脚本在 `127.0.0.1:8517` 临时启动夹具，完成后关闭；运行前应确保该端口空闲，并保持机器、浏览器、数据与后台负载可比。滚动按下一动画帧计量，其他场景取 Lit 更新完成；搜索耗时只反映浏览器渲染，不包含后端扫描或防抖。可加 `--profile` 为每个场景写出 CDP CPU profile。

```sh
node scripts/measure-ui-performance.mjs node_modules/.cache/pi-web/performance/baseline.json baseline 3ce6b61b
node scripts/measure-ui-performance.mjs node_modules/.cache/pi-web/performance/aligned.json upstream-aligned
node scripts/measure-ui-performance.mjs node_modules/.cache/pi-web/performance/custom-ui.json custom-ui --custom-ui
```

参数依次为输出 JSON、比较标签及可选源码基线或 `--custom-ui`。源码基线通过只读 `git ls-tree` / `git show` 加载，不切换分支或回退工作区；不传基线则使用当前源码，`--custom-ui` 启用定制展示。比较过程中断言保留内容与渲染行数，避免通过丢弃消息或会话产生虚假收益。原始 JSON 记录浏览器版本、样本、长任务、请求与节点数量，以及回收前后的 heap。夹具消息带时间戳元数据，并单独记录初始挂载耗时（`mountMs`，聊天与导航含首帧），因此日期与列表格式化成本计入；搜索场景的挂载只覆盖空对话框更新。

夹具的就绪耗时不是完整网关或应用首屏耗时，也不覆盖网络与插件启动；零延迟定时器探针不是真实用户 INP；Lit 更新耗时也不包含随后一帧。heap 样本只能辅助观察，不足以单独证明内存泄漏已修复。应保留原始分布，对中位数、尾部耗时和正确性一起判断，不把一次较快样本当作普遍收益。

初始 JavaScript 资源量另从生产构建测量：

```sh
npm run build
node scripts/measure-client-bundle.mjs node_modules/.cache/pi-web/performance/client-bundle.json final
```

该脚本只读取当前 `dist` 中入口、PiWebApp 启动模块及其递归静态 JavaScript 依赖，不计入后续动态导入，也不测量网络延迟或应用就绪时间。各版本需分别在对应源码构建后保存结果，不能拿旧 `dist` 代表新源码。

### 完整应用首屏

先安装 Playwright Chromium，再构建并运行完整首屏基线：

```sh
npm run build
node scripts/measure-startup-performance.mjs --out-dir node_modules/.cache/pi-web/performance/startup
```

脚本从 `dist` 启动仅监听本机的隔离 Web/API 和 sessiond，使用临时配置、合成项目和会话，不调用模型。登录、空工作区、已有会话直达分别在桌面和移动视口采样；每组默认 20 次，每次新建浏览器上下文，服务进程保持运行。不模拟网络或 CPU 降速。用 `--samples 1 --skip-trace` 快速检查环境和场景。

`report.json` 保留每次采样及 p50/p95。首屏可用时间以中文界面对应控件就绪为准，独立于可能只绘制启动遮罩的 FCP。报告还记录 TTFB、可用前发起的同源 HTTP 请求、已完成的 JS 传输量和长任务。失败样本单列并使脚本以非零状态退出。每组另有一个 Chromium trace，不参与分位数统计；在 Performance 面板中查看 `pi-web-startup-ready` 标记前的请求与主线程工作。

## 交付阶段

```sh
npm run build
npm run check:artifacts
```

`check:artifacts` 只读取当前 `dist` 产物，不会重建或刷新它。源码、依赖或打包输入改变后必须先构建。产物检查覆盖公开声明、包内容、部署相对 URL，以及插件自包含和大小限制；它不属于 `npm test` 或 `npm run verify`。

插件产物扫描跳过没有 `package.json` 的非包目录；已有包声明的读取错误和无效 JSON 仍会失败，并继续比对源码与构建产物中的服务端插件清单。

CI 和发布工作流在构建之后执行产物检查。Linux 上还执行 `npm run smoke:package-install`，验证真实全局安装、Web 与会话守护进程启动、公开 API 消费者解析以及原生 PTY。干净安装验收不能由源码或构建目录检查替代。

安装烟测分别提供隔离的 Pi 1.4.0、1.3.0、0.87.0、0.86.1 宿主，不把 SDK 装成 PI WEB 私有依赖；检查显式安装路径、npm peer 与 PATH 解析、Pi 管理安装、宿主替换后重启和 SDK/AI 对象身份。TypeBox 通过服务端专用 npm 别名 `pi-web-typebox` 加载，避免 Pi 的扩展依赖解析接管它。Windows 的普通测试覆盖运行时选择和真实 stdio MCP；POSIX 安装/PTY 烟测仍须在 Linux 环境运行，未运行不能记为通过。

```sh
npm run build
npm run smoke:package-install
```

Unlike ordinary tests or artifact inspection, the smoke test packs the existing build, installs the tarball with npm 12 into isolated temporary directories, and exercises the installed package. It checks installed dependency resolution and runtime behavior without source aliases. Some fixture tooling still comes from the checkout: TypeScript, Node typings, and the Pi resource loader. It is not a wholly independently provisioned consumer.

| Installed boundary | Protection |
| --- | --- |
| Shared Pi runtime | Independently installed Pi versions supply the SDK to fresh PI WEB CLI processes and server module checks. Isolated session daemons start, report the selected Pi version, and stop cleanly. PI WEB does not provision its own SDK. |
| Standalone server TypeBox | Native Node creates/validates schemas through the declared `pi-web-typebox` alias and imports the built server tools without Pi's module mapping or Vitest transforms. |
| Pi-managed install | A separate `--legacy-peer-deps` installation omits automatic SDK peers and uses the selected existing Pi installation to load the CLI and server tool modules. |
| Pi extension loading | The real Pi resource loader loads the installed `/pi-web` extension in both install layouts, registers its command, and reports no dependency warnings. |
| Public plugin API | Strict browser/server consumer and example compilations resolve installed public entries under NodeNext and Bundler; unsupported deep imports are rejected. |
| Native terminal | The installed stable `node-pty` and terminal service execute a real shell command, capture its output, and exit successfully. |

This catches missing packaged files, bad exports, undeclared or incorrectly resolved dependencies, peer-install-policy differences, resource-loader incompatibility, and native PTY/install-script failures that can pass in a development checkout. It does not replace application tests, install user services, verify full HTTP/WebSocket interactions or host admission, exercise browser rendering/live model calls, or test every supported machine/platform.

Its cost comes largely from downloading/installing npm and runtime dependencies into a fresh temporary cache, unpacking two install layouts, and strict consumer/example compilations. It requires registry access and a POSIX shell. Prefixes, caches, and fixture agent directories are temporary and cleaned up afterward; npm subprocesses get a temporary home. The harness and PTY still inherit the process environment and run with the user's permissions, so this is test isolation rather than a security sandbox. It does not install into the user's global prefix or restart the live session daemon.

### When to run it locally

Run it before merging a change to an installed-package boundary, or to reproduce a smoke failure. Examples include:

- Runtime dependencies, Pi SDK peers, TypeBox resolution, or npm/Pi install policy.
- `package.json` exports/files/bin contracts, packaging/build scripts, or public plugin API resolution.
- Shipped extension loading, built-in extension factories, native `node-pty`/terminal-service integration.
- The smoke script or its fixtures.

For a related change, the smoke command consumes the preceding build; rebuild after changing source or packaging inputs. Routine UI, route, application-logic, documentation, or unrelated test work does not require this command locally.

CI runs it after merges/pushes to `main` and on manual runs, on Linux only. Ordinary PR CI skips it; packaging-sensitive PRs should run it locally before merge or use a manual CI run for their branch. The publication workflow always runs it before publishing. This trades an installed-package check on every PR for a post-merge gate plus a final publication gate, while keeping the normal PR build/artifact checks.

The implementation lives in [`scripts/smoke-package-install.mjs`](../scripts/smoke-package-install.mjs) and [`scripts/plugin-api-package-smoke.mjs`](../scripts/plugin-api-package-smoke.mjs).

## Bun runtime delivery check

After building, run `npm run smoke:bun-install` with Bun 1.4.3 or newer on PATH (or set `BUN_EXECUTABLE` to its absolute path). The check packs a disposable payload copy, installs PI WEB and a separate fixture Pi with Bun, then verifies CLI selection, SDK session/extension loading, both services, HTTP, a real PTY over the paired WebSocket channel, size-specific rejection of valid oversized open/data envelopes on both direct and proxied paths, and clean exit after SIGTERM with a live shell. It also restarts the disposable daemon in recovery safe start to verify that Terminal status changes from active to disabled even though the runtime prerequisites are unchanged. It does not call a model or install user services. State, package-manager caches and prefixes are temporary; application children have no Node/npm on PATH. A machine may still have Node at the launcher's fixed discovery paths, so that test explicitly selects Bun.

Use `PI_WEB_SMOKE_WEB_RUNTIME=node` or `PI_WEB_SMOKE_SESSIOND_RUNTIME=node` to check mixed-runtime deployments. The default daemon transport is a Unix socket; set `PI_WEB_SMOKE_DAEMON_TRANSPORT=tcp` to cover TCP instead. For a genuine Bun-only check, run the script with Bun inside a disposable Linux container that has Bash, git and coreutils but no Node engine, mounting this checkout and its existing dependencies read-only. Set `PI_WEB_SMOKE_PREFERENCE=auto PI_WEB_SMOKE_NODE_ABSENT=1`; this additionally asserts that forced Node selection fails. The main/manual Linux CI gate runs this container check and both mixed-runtime cells. `PI_WEB_SMOKE_TARBALL` can supply an already-built tarball instead of packing the checkout.

Node's receiver can enforce channel payload limits during assembly. Bun's native transport does not expose that control, so shared decoders apply the same application limits after message delivery. Keep the real Bun oversized-frame and teardown regressions; they protect PI WEB's protocol behavior without depending on Bun's private buffer sizes or constructor names.

### Terminal composition and diagnostics

`ptyProvider.ts` defines the behavior consumed by `TerminalService`; `ptyComposition.ts` selects the implementation at activation. Keep runtime choices there rather than in terminal operations. Preflight checks whether the selected runtime's provider prerequisites are available, without activating plugins. Once sessiond is running, `/terminal-status` reports the activated plugin's lifecycle and its own health verdict, including deliberate recovery disablement. Neither check promises that every future operation will succeed; operation failures belong to the owning adapter/service and should be fixed there when discovered.

## Shared Pi runtime

PI WEB reuses the user's existing Pi installation. The `/pi-web` extension gets that installation through Pi's public `getPackageDir()` API and passes it to the CLI as `PI_WEB_PI_PACKAGE_DIR`. Native service definitions retain that selection. Without an explicit selection, ordinary npm SDK resolution takes precedence; if no peer is locally resolvable, standalone commands can find an existing npm-installed `pi` executable on `PATH`. An invalid explicit selection is an error, not permission to silently select a different Pi or install one.

Standalone application code imports SDK values through `src/piSdk.ts` and AI helpers through `src/piAi.ts`. Their shared loader, `src/piRuntime.ts`, resolves the selected installation's public package exports using `import-meta-resolve`. It does not register a Node loader hook, rewrite other modules' imports, or assume private SDK file paths. Pi's own dependencies and extension loader retain their ordinary resolution and module identity. Keep runtime imports behind this boundary; canonical type-only imports are safe because they disappear from emitted JavaScript. The fork retains its explicitly supported Pi SDK peers: `0.86.1`, `0.87.0`, `1.3.0`, and `1.4.0`; use the root package manifest as the supported-version contract. Development dependencies support the checkout's tests and typechecking rather than provisioning a published runtime.

Upgrading or downgrading Pi in place takes effect when services restart. If Pi moves to another path, reinstall the PI WEB service definitions from that Pi instance. The startup environment selects an installation, not a frozen copy of its version.

## Server-only TypeBox

`pi-web-typebox` is an npm alias for the ordinary `typebox` package, pinned to the server's existing version. It is not a fork or vendored copy.

PI WEB has two execution environments: its `/pi-web` extension runs inside Pi, while its CLI and session daemon run independently. Pi supplies TypeBox to extensions through its module mapping, but that mapping is not available to a standalone Node process. Depending on Pi's private TypeBox files or npm hoisting would make server resolution depend on the installation layout. Making TypeBox peer-only is also insufficient: Pi-managed installs suppress automatic peer installation.

Pi warns when an extension package lists `typebox` in `dependencies`, even if only its standalone server imports it ([#277](https://github.com/jmfederico/pi-web/issues/277)). The server-only alias retains an explicit runtime dependency without triggering that extension diagnostic. Server tool schemas and their tests import `pi-web-typebox`; code under `extensions/` must not import this alias or the server tools. Extensions that need TypeBox should use Pi's host-provided `typebox` instead.

The installed-package smoke checks native Node schema creation/validation and imports all three built server tool modules against the selected existing Pi installation. It also installs the tarball with Pi's `--legacy-peer-deps` policy. Both installations load `/pi-web` through the real Pi resource loader with no dependency warning; neither requires PI WEB to install another SDK.

Revisit the alias if Pi introduces a supported way to distinguish standalone runtime dependencies from extension dependencies. Until then, keep the explicit server dependency and preserve these installation checks rather than moving it to peers or relying on an undeclared transitive dependency.
