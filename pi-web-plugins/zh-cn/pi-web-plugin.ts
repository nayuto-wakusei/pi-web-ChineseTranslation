import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import components from "./components.json" with { type: "json" };
import client from "./client.json" with { type: "json" };
import bundled from "./bundled.json" with { type: "json" };
import metadata from "./metadata.json" with { type: "json" };

const messages = { ...components, ...client, ...bundled, ...metadata };

export default {
  apiVersion: 1,
  name: "简体中文",
  activate: () => ({
    contributions: { localizations: [{ locale: "zh-CN", messages }] },
  }),
} satisfies PiWebPlugin;
