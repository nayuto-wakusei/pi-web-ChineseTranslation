import { t } from "../../i18n";
import type { PiWebPlugin } from "../types";
import { createCoreActions } from "./actions";
export const corePlugin: PiWebPlugin = {
  apiVersion: 4,
  name: t("client.index.pi.web.core.d120ca", "PI WEB Core"),
  activate: () => ({
    contributions: {
      actions: createCoreActions(),
    },
  }),
};
