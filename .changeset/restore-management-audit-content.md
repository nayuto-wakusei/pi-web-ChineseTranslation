---
"@chainingintention/pi-web-cn": patch
---

恢复管理模式 Elasticsearch 审计的内容记录：受限和完整特权会话均保留用户问题、模型可见回复（不含思考内容）、工具参数和结果。服务日志及普通模式 SQLite 仍只保存元数据；审计正文可能含敏感数据，请限制 Elasticsearch 访问，升级后手动重启会话守护进程。
