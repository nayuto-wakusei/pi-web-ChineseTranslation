import { message } from "../localization/service";

export default {
  checkFailed: message<{ detail: string }>("PI WEB update check failed: {detail}", "Manual update check failure; detail is an untranslated registry diagnostic"),
  checkSkipped: message("PI WEB update check was skipped because remote version checks are disabled by offline/version-check settings", "Manual update check is disabled by gateway configuration"),
};
