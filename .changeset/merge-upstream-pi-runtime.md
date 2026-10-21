---
"@chainingintention/pi-web-cn": patch
---

复用宿主 Pi SDK 并将所选安装传给原生服务，避免混载多份运行时；保留 Pi 0.86.1、0.87.0 和 1.3.0 的明确兼容范围。

为 Pi 1.3.0 普通及完整特权管理会话接入 MCP、codemode 和 tool-search 内置扩展，保持受限管理隔离，限制结束运行的工具只能由模型直接调用，并拒绝共享 registry 中捕获会话上下文的虚拟模型。
