---
"@chainingintention/pi-web-cn": patch
---

将会话树限定在当前工作区，并让 `spawn_subsession` 始终在父会话工作区创建受跟踪子会话；同时缓存会话列表摘要，避免重复读取未变化的完整会话记录。需要在其它工作区运行时，请改用 `spawn_session` 创建独立会话。
