---
"@jmfederico/pi-web": patch
---

Improve user/assistant message distinction in the dark theme. Previously the user and assistant message backgrounds were nearly identical (contrast ratio ~1.06), making it hard to tell speakers apart. Each message now has a colored left accent stripe by role (brand accent for user, neutral for assistant) with matching header labels, applied across all themes. The dark theme's user-message background was also lightened and decoupled from the generic hover color, and the user border brightened, so user turns stand out clearly.
