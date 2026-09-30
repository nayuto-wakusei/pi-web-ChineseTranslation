---
"@chainingintention/pi-web-cn": patch
---

修复 systemd 审计和管理嵌入 drop-in 导致的服务环境误报，并让启动、重启与 doctor 的 Web 就绪检查读取已安装服务的配置。保留显式配置覆盖、数据目录和守护进程传输一致性检查，以及 EnvironmentFile 的严格拒绝策略。
