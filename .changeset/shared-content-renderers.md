---
"@chainingintention/pi-web-cn": patch
---

Add shared chat content renderers, chart preview, and workspace file links in both ordinary mode and management embed. Interactive terminals stay unavailable in management embed. File management stays in the existing Chinese files panel. The bundled chart preview uses a small sandboxed flowchart engine rather than the full Mermaid parser, so only simple `graph` and `flowchart` diagrams render.
