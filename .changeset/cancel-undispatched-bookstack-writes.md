---
"@chainingintention/pi-web-cn": patch
---

Stop cancelled BookStack writes before dispatch. If a submitted write loses its response, recover its original receipt across session restarts and repeated tool calls.
