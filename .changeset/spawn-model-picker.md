---
"@chainingintention/pi-web-cn": patch
---

代理委派任务时现在可以选择模型：`spawn_session` 和 `spawn_subsession` 接受可选的 `model` 参数，其值必须是精确的 `provider/model-id`（未知值会被拒绝，省略时继承当前模型）。在聊天输入框中键入 `#` 会打开模型补全菜单，并将 `#provider/model-id` 引用插入草稿，代理会把该引用作为对应参数传递。
