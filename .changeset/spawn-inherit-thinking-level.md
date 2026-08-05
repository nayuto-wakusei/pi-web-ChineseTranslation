---
"@chainingintention/pi-web-cn": patch
---

通过 `spawn_session` 和 `spawn_subsession` 创建的会话现在会继承发起会话的思考级别，并根据子会话模型的能力自动限制该级别，而不再回退到 Pi 的默认值。
