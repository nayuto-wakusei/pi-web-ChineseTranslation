---
"@chainingintention/pi-web-cn": patch
---

Disable Vite's development reload connection while preserving its dynamic-import helpers, so reconnecting a suspended PWA does not reload the UI or stall PI WEB realtime sockets.
