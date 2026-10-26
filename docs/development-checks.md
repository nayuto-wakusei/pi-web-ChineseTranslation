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

该命令包含类型检查、lint、未使用代码分析和普通测试。参考[测试指南](../.agents/skills/testing-guide/SKILL.md)，选择能够证明行为的最小边界。

按 import 选择相关测试不能覆盖所有运行时读取的文件。文档、Docker 资产、包清单和生成产物改动还需显式选择所属检查；空测试集不是通过。本地提交钩子仍使用 `verify:staged`，不以仅 whitespace 检查代替。

弹层、聊天滚动、命中区域和焦点组合需要[隔离浏览器用例](../test-fixtures/browser/)验证真实布局；DOM 单元测试负责事件和状态，不能证明浏览器几何。文档改动先核对链接、路径及相关静态资产，再检查差异；不把某个平台的跳过写成通过。

Windows 上的真实 bash 工具测试可通过 `PI_WEB_TEST_BASH` 指定已安装的 Git Bash；该变量仅供测试 fixture 使用，不修改服务或用户配置。全量检查建议限制 worker，避免冷启动子进程及大目录扫描争抢资源：

```powershell
$env:PI_WEB_TEST_BASH = 'D:\Program Files\Git\bin\bash.exe'
$env:VITEST_MAX_WORKERS = '4'
npm run verify
```

<a id="web-ui-performance"></a>
## Web UI 性能比较

使用隔离浏览器夹具比较流式更新、会话切换及大量会话导航，不连接真实模型或修改用户项目。脚本在 `127.0.0.1:8517` 临时启动夹具，完成后关闭；运行前应确保该端口空闲，并保持机器、浏览器、数据与后台负载可比。

```sh
node scripts/measure-ui-performance.mjs node_modules/.cache/pi-web/performance/baseline.json baseline 3ce6b61b
node scripts/measure-ui-performance.mjs node_modules/.cache/pi-web/performance/aligned.json upstream-aligned
node scripts/measure-ui-performance.mjs node_modules/.cache/pi-web/performance/custom-ui.json custom-ui --custom-ui
```

参数依次为输出 JSON、比较标签及可选源码基线或 `--custom-ui`。源码基线通过只读 `git ls-tree` / `git show` 加载，不切换分支或回退工作区；不传基线则使用当前源码，`--custom-ui` 启用定制展示。比较过程中断言保留内容与渲染行数，避免通过丢弃消息或会话产生虚假收益。原始 JSON 记录浏览器版本、样本、长任务、请求与节点数量，以及回收前后的 heap。

夹具的就绪耗时不是完整网关或应用首屏耗时，零延迟定时器探针不是真实用户 INP；Lit 更新耗时也不包含随后一帧。heap 样本只能辅助观察，不足以单独证明内存泄漏已修复。应保留原始分布，对中位数、尾部耗时和正确性一起判断，不把一次较快样本当作普遍收益。

初始 JavaScript 资源量另从生产构建测量：

```sh
npm run build
node scripts/measure-client-bundle.mjs node_modules/.cache/pi-web/performance/client-bundle.json final
```

该脚本只读取当前 `dist` 中入口、PiWebApp 启动模块及其递归静态 JavaScript 依赖，不计入后续动态导入，也不测量网络延迟或应用就绪时间。各版本需分别在对应源码构建后保存结果，不能拿旧 `dist` 代表新源码。

## 交付阶段

```sh
npm run build
npm run check:artifacts
```

`check:artifacts` 只读取当前 `dist` 产物，不会重建或刷新它。源码、依赖或打包输入改变后必须先构建。产物检查覆盖公开声明、包内容、部署相对 URL，以及插件自包含和大小限制；它不属于 `npm test` 或 `npm run verify`。

插件产物扫描跳过没有 `package.json` 的非包目录；已有包声明的读取错误和无效 JSON 仍会失败，并继续比对源码与构建产物中的服务端插件清单。

CI 和发布工作流在构建之后执行产物检查。Linux 上还执行 `npm run smoke:package-install`，验证真实全局安装、Web 与会话守护进程启动、公开 API 消费者解析以及原生 PTY。干净安装验收不能由源码或构建目录检查替代。

安装烟测分别提供隔离的 Pi 1.3.0、0.87.0、0.86.1 宿主，不把 SDK 装成 PI WEB 私有依赖；检查显式安装路径、npm peer 与 PATH 解析、Pi 管理安装、宿主替换后重启和 SDK/AI 对象身份。TypeBox 通过服务端专用 npm 别名 `pi-web-typebox` 加载，避免 Pi 的扩展依赖解析接管它。Windows 的普通测试覆盖运行时选择和真实 stdio MCP；POSIX 安装/PTY 烟测仍须在 Linux 环境运行，未运行不能记为通过。
