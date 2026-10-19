---
"@chainingintention/pi-web-cn": patch
---

补充管理嵌入会话重新 launch 后替换旧授权、保留 bash/network 特权并转发至会话守护进程的回归覆盖。本次不改变运行时权限逻辑；特权仍需启用机器配置 managementEmbed.allowPrivileged。
