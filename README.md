# PI WEB

PI WEB 的中文本地化分支，保留上游功能，并将核心界面与内置插件的显示内容本地化为中文。

[![CI](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40chainingintention%2Fpi-web-cn)](https://www.npmjs.com/package/@chainingintention/pi-web-cn)
[![Node.js](https://img.shields.io/node/v/%40chainingintention%2Fpi-web-cn)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**PI WEB 是 [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) 的 Web 界面，让代理会话持续运行在机器或服务器的真实工作区中。**

内置运行时支持已测试的 Pi `0.86.1` 或 `0.87.0`。每个会话守护进程独占 `PI_WEB_DATA_DIR`，并发实例必须使用独立数据目录和 daemon endpoint。

让代理在代码、工具、凭据和构建缓存所在的机器工作，从任何浏览器监督。

上游网站与文档：<https://pi-web.dev/>。本分支的包名、项目认证与管理隔离等差异以仓库中的[配置参考](docs/config.md)和[插件指南](docs/plugins.md)为准。

![PI WEB](docs/assets/pi-web-banner.png)
![PI WEB 桌面截图](docs/assets/pi-web-desktop.png)

## 为什么使用 PI WEB？

持久的工作环境适合代理开发。PI WEB 可以：

- 浏览器断开后继续运行代理会话；
- 在真实仓库与 Git 工作树中工作；
- 并行监督多个会话；
- 在电脑、手机和平板间切换；
- 使用服务器、工作站或远端开发机运行代理；
- 从一个界面管理项目、工作区、文件、终端、会话及远端机器。

浏览器负责监督，工作留在能够持续运行的机器。

## 快速开始

需要 Node.js 22.19.0 或更新版本、npm、为当前用户配置的 Pi Coding Agent `0.86.1` 或 `0.87.0`，以及 Git 和项目所需开发工具。

安装并启动用户服务：

```bash
npm install -g @chainingintention/pi-web-cn --allow-scripts=node-pty
pi-web install
pi-web doctor
```

npm 12 的限定开关只允许 node-pty 准备所需原生模块，不为其他依赖开启安装脚本。

打开：

```text
http://127.0.0.1:8504
```

常用命令：

```bash
pi-web status
pi-web logs
pi-web restart
pi-web doctor
pi-web version
pi-web uninstall
```

安装变体、Pi 包安装、WSL/手动启动与远端访问见[安装指南](https://pi-web.dev/install)。

## 核心模型

```text
Machine     本地或远端 PI WEB 运行时
Project     该机器上的项目目录
Workspace   提供器拥有的工作目录；内置 Git 发现工作树，无提供器时使用项目目录
Session     工作区中运行的 Pi Coding Agent 对话
```

典型流程：添加项目 → 选择工作区 → 启动会话 → 让代理工作 → 稍后从任何浏览器返回。

## 远端优先

让代理运行在保持在线的服务器、桌面机、云主机、家用实验室或远端开发机，不依赖笔记本浏览器会话。远端连接使用私有网络、SSH 隧道、可信反向代理或 PI WEB 机器联邦。

详见[远端优先开发](https://pi-web.dev/remote-first)。

## 机器与联邦

一个浏览器网关可代理可信远端机器的项目、工作区、文件、Git、会话、终端、活动、Pi 包与设置。设置页标明目标机器：包、插件、daemon 能力、文件访问和上传默认值针对所选机器；网关监听地址/端口/允许主机、机器注册/令牌和快捷键仍在网关。

详见[机器指南](https://pi-web.dev/machines)。

## PI WEB 插件

可信插件可提供面板、工具和工作区工作流，从 **设置 → PI WEB 插件** 管理所选机器的启用状态。Pi 包的安装与插件启用是独立操作。服务端插件变更需手动重启会话守护进程，再刷新浏览器；仅 Web 重启或 `/reload` 不会激活。

详见[插件指南](docs/plugins.md)。

## 配置

机器配置在 `$PI_WEB_CONFIG` 或 `~/.config/pi-web/config.json`，项目配置在 `<project>/.pi-web/config.json`。包括网络、路径访问、上传/附件、插件、快捷键和会话工具。普通模型认证与默认值按项目托管，管理嵌入独立，详见[配置参考](docs/config.md)。

## 开发

克隆仓库后：

```bash
npm install
npm run dev
```

打开 Vite URL，通常为 `http://localhost:8505`。拆分开发启动使用三个独立终端，先启动 Web：

```bash
npm run dev:web
npm run start:sessiond
npm run dev:client
```

daemon 等待 Web 拥有的插件构建就绪，不自动重载。构建/重启顺序见[服务启动说明](https://pi-web.dev/install#manage-services)。

验证改动：

```bash
npm run verify
```

交付构建与产物检查见[开发检查](docs/development-checks.md)。

## 安全模型

普通模式假定用户、仓库与服务器路径可信，不是多租户平台或代理沙箱。不要在没有可信网络、防火墙、VPN、SSH 隧道或认证代理时直接暴露到公网。管理嵌入使用独立授权资源、受控工具、沙箱与审计，不与普通模式共享权限。

## 文档

- [代码库维护文档：架构、模块契约、改动地图与验证](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/maintenance.md)
- [上游网站](https://pi-web.dev/)
- [安装](https://pi-web.dev/install)
- [远端优先](https://pi-web.dev/remote-first)
- [机器](https://pi-web.dev/machines)
- [配置](docs/config.md)
- [插件](docs/plugins.md)
- [常见问题](https://pi-web.dev/faq)

## 许可

MIT © 2026 Federico Jaramillo Martinez，见 [LICENSE](LICENSE)。
