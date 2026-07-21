---
"@chainingintention/pi-web-cn": patch
---

隔离普通模式下各项目的 `auth.json` 和 `models.json`，并要求普通模式的认证与会话请求绑定到已注册项目。首次使用项目时会从全局 Pi 文件迁移一份初始副本，之后各项目独立保存提供商凭据和自定义模型。
