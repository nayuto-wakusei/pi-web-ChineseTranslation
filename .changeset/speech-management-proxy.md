---
"@chainingintention/pi-web-cn": patch
---

Fix composer speech transcription in the management embed. The gateway now forwards the verified management context (and keeps the managed workspace sandbox check) instead of rejecting the request through the plugin-session proxy. Plugin catalog and plugin session routes keep denying management callers.
