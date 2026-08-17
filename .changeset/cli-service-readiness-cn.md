---
"@chainingintention/pi-web-cn": patch
---

增强 `pi-web doctor`、`start` 和 `restart` 的服务就绪性检查，修复 macOS LaunchAgent 重启竞态，并让 Docker 内的会话守护进程恢复操作使用对应的 Docker 控制命令。启用普通模式登录保护时，CLI 会把认证响应识别为 Web 服务在线，但不会把无法读取的运行版本误报为已验证。
