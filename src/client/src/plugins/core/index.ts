import { t } from "../../i18n";
import type { PiWebPlugin } from "../types";
import { isManagementEmbedMode } from "../../api/managementEmbed";
import { createCoreActions } from "./actions";
import { createCoreWorkspacePanels } from "./panels";

export const corePlugin: PiWebPlugin = {
  apiVersion: 1,
  name: t("client.index.pi.web.core.d120ca", "PI WEB Core"),
  activate: () => {
    const terminalEnabled = !isManagementEmbedMode();
    return {
      contributions: {
        actions: terminalEnabled ? createCoreActions() : createCoreActions().filter((action) => action.id !== "view.terminal"),
        workspacePanels: terminalEnabled ? createCoreWorkspacePanels() : createCoreWorkspacePanels().filter((panel) => panel.id !== "workspace.terminal"),
      },
    };
  },
};
