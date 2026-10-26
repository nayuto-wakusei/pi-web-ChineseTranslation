---
"@chainingintention/pi-web-cn": patch
---

Prevent management embed entry from automatically restoring browser-only empty sessions that are absent from the authorized server list. Preserve cached drafts, attachments and explicit session selection. Skip unnecessary workspace deletion command queries when there are no removable workspaces or tracked deletion tasks, without changing server permissions.
