# 性能基线与并发压测

仓库提供 `npm run perf:load` 作为本机 Web/API 和 WebSocket 基线工具。它只使用 Node.js 与项目已有的 `ws` 依赖，不会调用模型，也不会把请求体、提示词或凭据写入结果。

最小检查：

```powershell
npm run perf:load -- --url http://127.0.0.1:8504/api/sessiond/health --ws ws://127.0.0.1:8504/api/events --duration 60 --concurrency 200 --ws-connections 200
```

可用参数包括 `--duration`（秒）、`--concurrency`、`--ws-connections`、`--timeout`（HTTP 请求与 WS 握手超时，秒）。`--expect-json '{"ok":true}'` 验证业务响应，避免将 HTTP 200 登录页误判为成功。延迟包含失败请求，使用有界直方图统计；`--output result.json` 保存报告与 `result.json.metrics.tsv`。失败请求、握手失败或非预期断连使脚本以非零状态退出。

### 分别测试 Cookie 和 Bearer

将测试密码保存在仅当前用户可读的文件中。使用 `--auth bearer --password-file FILE` 或 `--auth cookie --password-file FILE`；Cookie 模式先正常登录，再将会话 Cookie 用于 HTTP 和 WebSocket。不要把真实凭据放到命令行的 `--header` 或 URL 中。

Linux 示例（先填写实际 Web/sessiond PID，两个场景串行执行）：

```bash
for mode in bearer cookie; do
  node scripts/perf-load.mjs \
    --url http://127.0.0.1:8504/api/sessiond/health \
    --ws ws://127.0.0.1:8504/api/events \
    --auth "$mode" --password-file /path/to/test-password \
    --duration 300 --concurrency 200 --ws-connections 200 \
    --expect-json '{"ok":true}' \
    --web-pid "$WEB_PID" --sessiond-pid "$SESSIOND_PID" \
    --output "$mode-200.json" || break
done
```

`loadGenerator` 和 `loadGeneratorEventLoopDelayMs` 只描述压测进程。`processSamples` 每秒按角色与 PID 采样；Linux 从 `/proc` 读取 CPU、RSS、FD，使用 `getconf CLK_TCK` 换算 CPU，100% 表示一个逻辑核。非 Linux 或进程不可读时对应指标为 null。未注入服务端事件循环采样，因此 `serverEventLoopDelayMs` 为 null；不把 WS 存活当作广播/背压验证，`broadcastAcceptance` 也为 null。无长期事件源时只报告建连、存活、断连和消息计数。

### 隔离鉴权测试

`node --import tsx scripts/perf-auth-fixture.mjs node_modules/.cache/auth-perf` 启动只监听本机的临时服务，使用真实普通模式鉴权、随机测试密码和 `/api/test-health`、`/api/events`。目录内 `fixture.json` 提供地址和 PID，`password.txt` 供压测脚本读取。该测试验证认证路径，不代表完整 sessiond、Git 或真实项目容量；测试后停止进程并删除测试密码文件。

### Bearer 校验策略

有效 Bearer 的校验结果在当前 Web 进程内保留固定 60 秒，最多 128 条，不保存明文凭据；请求仍检查当前密码配置。密码变更或移除后旧校验缓存及浏览器会话失效。密码校验保持 PBKDF2-SHA256 的既有强度，使用异步计算，最多 4 项同时执行、32 项排队。同一凭据的首次并发请求合并校验，失败结果不缓存；校验任务超载返回 503，客户端应退避重试。原有错误登录限速保持不变。

建议按 100、200、400 个连接逐级运行。200 个连接用于容量验收：读请求 p95 不高于 500 ms、p99 不高于 1 s，WebSocket 建连成功率至少 99%，请求错误率低于 1%。400 个连接用于观察资源拐点，不代表所有机器都支持该容量。

慢 WebSocket 客户端的待发送缓冲超过 8 MiB 时会被终止，重新连接后通过现有快照/刷新流程恢复状态。这是为了限制单个客户端的内存影响；会话事件序号和安全作用域保持不变。
