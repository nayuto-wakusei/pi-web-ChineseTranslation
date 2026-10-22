import { t } from "../../i18n";
import type { PiWebPlugin } from "../types";
import { createCoreActions } from "./actions";
import { createCoreMessageActions } from "./messageActions";
export const corePlugin: PiWebPlugin = {
  apiVersion: 5,
  name: t("client.index.pi.web.core.d120ca", "PI WEB Core"),
  activate: () => ({
    contributions: {
      actions: createCoreActions(),
      messageActions: createCoreMessageActions(),
    },
  }),
};
