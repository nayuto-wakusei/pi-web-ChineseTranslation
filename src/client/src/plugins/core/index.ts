import type { PiWebPlugin } from "../types";
import { isManagementEmbedMode } from "../../api/managementEmbed";
import { createCoreActions } from "./actions";
import { createCoreWorkspacePanels } from "./panels";

export const corePlugin: PiWebPlugin = {
  apiVersion: 2,
  name: "PI WEB 核心",
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
