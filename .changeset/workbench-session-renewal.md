---
"@chainingintention/pi-web-cn": patch
---

修复管理端嵌入会话在入口 Token 或资源授权过期后需要返回工作台重新进入的问题。在原始管理登录有效期内自动续期私有 Agent Session，并在页面请求和工具调用前重新校验当前权限。

需要配套工作台后端提供 Agent Session 续期接口；已撤销授权、禁用账号和超过登录有效期的会话仍会被拒绝。
