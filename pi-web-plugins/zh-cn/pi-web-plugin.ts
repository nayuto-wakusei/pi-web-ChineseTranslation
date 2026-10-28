import type { PiWebPlugin } from "@chainingintention/pi-web-cn/plugin-api";
import components from "./components.json" with { type: "json" };
import client from "./client.json" with { type: "json" };
import bundled from "./bundled.json" with { type: "json" };
import metadata from "./metadata.json" with { type: "json" };
import main from "./main.json" with { type: "json" };
import server from "./server.json" with { type: "json" };
import serverMain from "./server-main.json" with { type: "json" };
import catalogs from "./catalogs.json" with { type: "json" };

const messages = { ...components, ...client, ...bundled, ...metadata, ...main, ...server, ...serverMain };

export default {
  apiVersion: 5,
  name: "简体中文",
  activate: ({ localization }) => {
    for (const [namespace, catalog] of Object.entries(catalogs)) {
      localization?.registerCatalog({
        id: `zh-cn:${namespace}`,
        namespace,
        locale: "zh-CN",
        load: () => Promise.resolve(catalog),
      });
    }
    return { contributions: { localizations: [{ locale: "zh-CN", messages }] } };
  },
} satisfies PiWebPlugin;
