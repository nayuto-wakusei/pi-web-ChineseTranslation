---
"@chainingintention/pi-web-cn": patch
---

跟进上游依赖版本，增加 Pi SDK 1.3.0 支持并适配伴随扩展的启动事件，更新 Markdown、图表、编辑器与服务端依赖。

保留 WebSocket 协议错误的关闭握手，使载荷超限时正确返回关闭码 1009，而非异常断开的 1006。
