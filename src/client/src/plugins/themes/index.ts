import { t } from "../../i18n";
import type { PiWebPlugin } from "../types";

export const themePackPlugin: PiWebPlugin = {
  apiVersion: 5,
  name: t("client.index.pi.web.themes.9c5a30", "PI WEB Themes"),
  activate: () => ({
    contributions: {
      themes: [
        {
          id: "pi-web-dark",
          name: t("client.index.pi.web.dark.91b604", "PI WEB Dark"),
          description: t("client.index.pi.web.dark.color.scheme.9d56a4", "Dark PI WEB palette."),
          order: 10,
          colorScheme: "dark",
          stylesheets: [{ id: "palette", url: new URL("./pi-web-dark.css?no-inline", import.meta.url).href }],
        },
        {
          id: "pi-web-light",
          name: t("client.index.pi.web.light.081df9", "PI WEB Light"),
          description: t("client.index.pi.web.light.color.scheme.b51736", "Light PI WEB palette."),
          order: 20,
          colorScheme: "light",
          stylesheets: [{ id: "palette", url: new URL("./pi-web-light.css?no-inline", import.meta.url).href }],
        },
        {
          id: "classic",
          name: t("client.index.pi.web.classic.4793fe", "PI WEB Classic"),
          description: t("client.index.original.pi.web.dark.color.scheme.80bcd3", "The original PI WEB dark palette."),
          order: 30,
          colorScheme: "dark",
          stylesheets: [{ id: "palette", url: new URL("./classic.css?no-inline", import.meta.url).href }],
        },
        {
          id: "paper",
          name: "Paper",
          description: t("client.themes.paper.description", "White and neutral grays with restrained status colors."),
          order: 40,
          colorScheme: "light",
          stylesheets: [{ id: "palette", url: new URL("./paper.css?no-inline", import.meta.url).href }],
        },
        {
          id: "graphite",
          name: "Graphite",
          description: t("client.themes.graphite.description", "Charcoal and neutral grays with restrained status colors."),
          order: 50,
          colorScheme: "dark",
          stylesheets: [{ id: "palette", url: new URL("./graphite.css?no-inline", import.meta.url).href }],
        },
      ],
      themePairs: [
        {
          id: "pi-web",
          name: "PI WEB",
          description: t("client.index.follow.the.system.light.dark.preference.with.pi.web.themes.33941c", "Follow the system light/dark preference with PI WEB themes."),
          order: 10,
          light: "pi-web-light",
          dark: "pi-web-dark",
        },
        {
          id: "paper-graphite",
          name: "Paper / Graphite",
          description: t("client.themes.neutralPair.description", "Follow the system light/dark preference with neutral gray themes."),
          order: 20,
          light: "paper",
          dark: "graphite",
        },
      ],
    },
  }),
};
