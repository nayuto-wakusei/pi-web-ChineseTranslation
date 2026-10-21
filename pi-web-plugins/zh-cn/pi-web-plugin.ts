import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import components from "./components.json" with { type: "json" };
import client from "./client.json" with { type: "json" };
import bundled from "./bundled.json" with { type: "json" };
import metadata from "./metadata.json" with { type: "json" };
import main from "./main.json" with { type: "json" };
import server from "./server.json" with { type: "json" };
import serverMain from "./server-main.json" with { type: "json" };

const messages = { ...components, ...client, ...bundled, ...metadata, ...main, ...server, ...serverMain };

export default {
  apiVersion: 4,
  name: "简体中文",
  activate: () => ({
    contributions: { localizations: [{ locale: "zh-CN", messages }] },
  }),
} satisfies PiWebPlugin;
