---
"@chainingintention/pi-web-cn": patch
---

协调开发环境的插件构建与服务启动：Web 完成首次构建后才启动 API，daemon 等待插件就绪；开发服务启动和服务重启先验证 Web，再处理 daemon。Web 构建或就绪检查失败时不重启 daemon，保留其手动重启和活动会话所有权。
