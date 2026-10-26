---
"@chainingintention/pi-web-cn": patch
---

Restore consistent upstream menu and control styling, and move local visual customizations into the optional, default-enabled Custom UI Codex browser plugin. Add gateway-owned UI presentation regions with upstream fallback, preserve existing theme choices, and improve streaming transcript and large-session-list rendering while loading settings on demand.

Adapt the Codex-inspired plugin layout with a nested selected-project tree, quick navigation actions, centered composer, and full-screen responsive settings while preserving file operations, trust controls, and existing permission boundaries. Use a text Actions button in the plugin header instead of the lightning icon.

Keep mobile tree navigation and attachment menus usable, reveal folded ancestors when navigating to a session, recognize migrated themes in settings, and invalidate presentation actions when their owner becomes inactive.

Keep the default theme shown in settings consistent with the theme applied when clearing a browser override, including the custom UI plugin's implicit default.

Refresh visible Markdown during continuous output by coalescing new text without postponing queued formatting, while preserving deferred previews and offscreen rendering.
