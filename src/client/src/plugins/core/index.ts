import type { PiWebPlugin } from "../types";
import { createCoreActions } from "./actions";
export const corePlugin: PiWebPlugin = {
  apiVersion: 4,
  name: "PI WEB 核心",
  activate: () => ({
    contributions: {
      actions: createCoreActions(),
    },
  }),
};
