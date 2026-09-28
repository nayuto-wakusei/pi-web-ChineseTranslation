import type { PiWebPlugin } from "../types";
import { createCoreActions } from "./actions";
import { createCoreWorkspacePanels } from "./panels";

export const corePlugin: PiWebPlugin = {
  apiVersion: 4,
  name: "PI WEB 核心",
  activate: () => ({
    contributions: {
      actions: createCoreActions().filter((action) => action.id !== "view.files" && action.id !== "workspace.refresh-files"),
      workspacePanels: createCoreWorkspacePanels(),
    },
  }),
};
