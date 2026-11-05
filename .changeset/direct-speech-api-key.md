---
"@chainingintention/pi-web-cn": patch
---

Allow speech recognition API keys to be entered and reloaded in Settings while retaining environment-variable authentication. Keep ordinary configuration responses redacted, backfill saved keys into password fields through an authenticated non-cached read, and preserve unchanged keys when other settings change.
