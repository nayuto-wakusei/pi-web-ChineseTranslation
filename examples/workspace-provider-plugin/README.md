# PI WEB 双入口工作区提供器示例

这是可独立构建的可信插件示例，使用浏览器 API v4 和服务端 API v3。只有存在标记文件的项目才会被接管；提供器向浏览器发布非敏感元数据，并通过同一版本包的 peer 执行有界请求。peer 契约与工作区提供器所有权相互独立。

公开声明入口为 `@chainingintention/pi-web-cn/plugin-api` 和 `@chainingintention/pi-web-cn/server-plugin-api`。最低插件平台版本为 `^1.202609.1`。

## 构建与安装

从仓库或已安装包取出 `examples/workspace-provider-plugin/`，在独立目录运行：

```bash
npm install
npm run build
mkdir -p ~/.pi-web/plugins
ln -s "$PWD" ~/.pi-web/plugins/example-workspaces
```

若设置了 `PI_WEB_DATA_DIR`，链接应位于 `$PI_WEB_DATA_DIR/plugins`。链接名必须是合法、未冲突的插件 ID。仅对要启用此提供器的已注册项目创建标记：

```bash
mkdir -p /absolute/path/to/project/.pi-web
touch /absolute/path/to/project/.pi-web/example-workspace-provider
```

在确认可中断会话后，从守护进程所托管的会话之外手动重启目标 daemon，再刷新浏览器：

```bash
systemctl --user restart pi-web-sessiond
```

仅重启浏览器或 Web/API 不会激活服务端入口。打开已启用的项目，在“提供器示例”面板获取摘要，按钮调用包的 `summary` 操作。移除标记并重启 daemon，或触发后续工作区解析，即可停止接管。

## 包边界

`package.json` 声明浏览器入口 `dist/browser/index.js`、`browserRoot: "dist/browser"`、浏览器目录外的服务端入口 `dist/server.js` 和双入口必需的 `machineSpecific: true`。

仅 `dist/browser/` 下的文件可以通过浏览器资源路由提供。源码、包元数据、服务端入口和依赖不在该路由内。`publicMetadata` 对所有浏览器脚本和 API 消费者可见，不能存放秘密。

本例不提供工作区移除能力，也不依赖延迟提供的宿主工作区或会话能力。生命周期、类型化能力、包级状态、peer/channel 限制、联邦机器和完整 API 见[插件指南](../../docs/plugins.md)。
