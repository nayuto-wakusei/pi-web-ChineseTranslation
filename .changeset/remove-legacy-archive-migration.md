---
"@jmfederico/pi-web": patch
---

Remove the legacy session archive migration from session daemon startup. Each `PI_WEB_DATA_DIR` data directory is independent: pointing PI WEB at a new data directory starts there with empty registries and no session archives.

You are only affected if you have session archives created before July 2026 in the default `~/.pi-web` data directory and you newly set a custom `PI_WEB_DATA_DIR`. To carry those archives over, stop PI WEB, then copy `archived-sessions.json` and the `archived-sessions/` directory from the old data directory into the new one.
