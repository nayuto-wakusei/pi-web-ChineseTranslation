---
"@jmfederico/pi-web": patch
---

Keep the chat prompt input stable during streaming so mobile touch gestures (such as the iOS long-press paste/edit callout) are no longer interrupted. Session status and activity updates are now coalesced into a single render per animation frame instead of one per token, the prompt editor ignores status changes that do not affect what it displays, and per-keystroke draft state no longer triggers surrounding re-renders.
