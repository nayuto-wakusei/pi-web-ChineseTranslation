---
"@chainingintention/pi-web-cn": patch
---

Upgrade bundled plugins to browser plugin API v4 and server plugin API v3 with no compatibility shim. Package-paired server requests now go through `peer.request` instead of the legacy workspace-provider `request` method. This note records a breaking plugin API change; it is not a major release.
