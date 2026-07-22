---
"@chainingintention/pi-web-cn": patch
---

按模式与项目隔离会话偏好默认值（思考级别与默认模型）。会话继续读取真实 agent 的 packages/extensions 等共享配置，避免首次打开会话后冻结全局 package 列表。
