---
"@chainingintention/pi-web-cn": patch
---

支持配置自动会话命名的模型、token 预算、思考等级和超时，设置只影响后续命名请求，并继续使用所属项目或管理模式的模型凭据。

支持通过 sessionArchive.directory 或 PI_WEB_SESSION_ARCHIVE_DIR 指定新归档的存放目录。原索引及旧归档路径保持可读，不自动迁移历史文件；归档目录变更需重启会话守护进程。
