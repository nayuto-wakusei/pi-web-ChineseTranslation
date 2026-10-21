# 开发与交付检查

开发时优先验证应用行为；编译、公开声明和打包使用独立的交付门槛。

## 开发阶段

先运行与改动相关的最小测试：

```sh
npm test -- src/server/plugins/serverPluginRuntime.test.ts
```

跨模块改动合并前运行：

```sh
npm run verify
```

该命令包含类型检查、lint、未使用代码分析和普通测试。参考[测试指南](../.agents/skills/testing-guide/SKILL.md)，选择能够证明行为的最小边界。

Windows 上的真实 bash 工具测试可通过 `PI_WEB_TEST_BASH` 指定已安装的 Git Bash；该变量仅供测试 fixture 使用，不修改服务或用户配置。全量检查建议限制 worker，避免冷启动子进程及大目录扫描争抢资源：

```powershell
$env:PI_WEB_TEST_BASH = 'D:\Program Files\Git\bin\bash.exe'
$env:VITEST_MAX_WORKERS = '4'
npm run verify
```

## 交付阶段

```sh
npm run build
npm run check:artifacts
```

`check:artifacts` 只读取当前 `dist` 产物，不会重建或刷新它。源码、依赖或打包输入改变后必须先构建。产物检查覆盖公开声明、包内容、部署相对 URL，以及插件自包含和大小限制；它不属于 `npm test` 或 `npm run verify`。

插件产物扫描跳过没有 `package.json` 的非包目录；已有包声明的读取错误和无效 JSON 仍会失败，并继续比对源码与构建产物中的服务端插件清单。

CI 和发布工作流在构建之后执行产物检查。Linux 上还执行 `npm run smoke:package-install`，验证真实全局安装、Web 与会话守护进程启动、公开 API 消费者解析以及原生 PTY。干净安装验收不能由源码或构建目录检查替代。

安装烟测分别提供隔离的 Pi 1.3.0、0.87.0、0.86.1 宿主，不把 SDK 装成 PI WEB 私有依赖；检查显式安装路径、npm peer 与 PATH 解析、Pi 管理安装、宿主替换后重启和 SDK/AI 对象身份。TypeBox 通过服务端专用 npm 别名 `pi-web-typebox` 加载，避免 Pi 的扩展依赖解析接管它。Windows 的普通测试覆盖运行时选择和真实 stdio MCP；POSIX 安装/PTY 烟测仍须在 Linux 环境运行，未运行不能记为通过。
