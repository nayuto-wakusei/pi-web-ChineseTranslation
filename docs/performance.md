# 性能基线与并发压测

仓库提供 `npm run perf:load` 作为本机 Web/API 和 WebSocket 基线工具。它只使用 Node.js 与项目已有的 `ws` 依赖，不会调用模型，也不会把请求体、提示词或凭据写入结果。

最小检查：

```powershell
npm run perf:load -- --url http://127.0.0.1:8504/api/sessiond/health --ws ws://127.0.0.1:8504/api/events --duration 60 --concurrency 200 --ws-connections 200
```

可用参数包括 `--duration`（秒）、`--concurrency`、`--ws-connections`、`--timeout`（秒）和逗号分隔的 `--header`。脚本输出 JSON，包含 HTTP 吞吐量与延迟分位数、WebSocket 建连成功率、事件循环延迟、进程 RSS 和 CPU 时间。

建议按 100、200、400 个连接逐级运行。200 个连接用于容量验收：读请求 p95 不高于 500 ms、p99 不高于 1 s，WebSocket 建连成功率至少 99%，请求错误率低于 1%。400 个连接用于观察资源拐点，不代表所有机器都支持该容量。

慢 WebSocket 客户端的待发送缓冲超过 8 MiB 时会被终止，重新连接后通过现有快照/刷新流程恢复状态。这是为了限制单个客户端的内存影响；会话事件序号和安全作用域保持不变。
