---
"@chainingintention/pi-web-cn": patch
---

Integrate upstream language and regional settings, layered configuration with explicit resets, quiet mode, manual unread state, richer file previews, and maintenance terminals while preserving the default Chinese language pack, project-scoped authentication, management isolation, and optional Codex-style UI.

Add Bun-aware launchers and Ubuntu/mise Docker tooling. Reconcile bundled package paths after upgrades and retain the Chinese package identity. Remove the retired Captain's Log package and session-bridge example. Align and restart both Web and sessiond when deploying this update; merging or installing alone does not restart services.

Before upgrading, replace arbitrary or empty boolean environment values with `true`/`false` or `1`/`0`, or unset them. In particular, `false` and `0` no longer enable offline/version-check suppression flags. Environment-enforced settings are read-only, unknown fields in core path/upload/attachment namespaces are rejected, and finite extension-dialog timeouts cannot exceed 2147483647 milliseconds. Keep deployment defaults separate from writable configuration and apply matching environment settings to both services.
