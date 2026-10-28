import { createTranslator, type Translator } from "../../shared/i18n.js";

export const NODE_PTY_GLOBAL_REINSTALL_COMMAND = "npm install -g @chainingintention/pi-web-cn --allow-scripts=node-pty";

export type NodePtyNativeModuleCheck =
  | { status: "ok" }
  | { status: "load-failed"; message: string };

export interface FormattedNodePtyNativeModuleCheck {
  ok: boolean;
  lines: string[];
}

export function formatNodePtyNativeModuleCheck(check: NodePtyNativeModuleCheck, t: Translator = createTranslator("en", {})): FormattedNodePtyNativeModuleCheck {
  const doctorLabel = t("diagnostics.nativeLabel", "node-pty native module loadable");
  if (check.status === "ok") return { ok: true, lines: [`✓ ${doctorLabel}`] };
  return {
    ok: false,
    lines: [
      `✗ ${doctorLabel}`,
      t("diagnostics.ptyLoad", "  Could not load node-pty: {arg0}", { arg0: check.message }),
      t("diagnostics.ptyScript", "  npm may have skipped node-pty's required install script."),
      t("diagnostics.ptyReinstall", "  For a global npm installation, reinstall PI WEB with:"),
      `    ${NODE_PTY_GLOBAL_REINSTALL_COMMAND}`,
      t("diagnostics.doctorAgain", "  Then run `pi-web doctor` again."),
    ],
  };
}
