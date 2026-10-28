import type { MessageDefinition } from "@chainingintention/pi-web-cn/plugin-api";

function text(message: string, description: string): MessageDefinition<Record<string, never>> {
  return { message, description };
}

export default {
  diagram: text("Diagram", "Renderer view button for Mermaid diagrams"),
  rendering: text("Rendering diagram…", "Status while the isolated diagram engine loads"),
  frameTitle: text("Mermaid diagram", "Accessible name of the isolated diagram frame"),
};
