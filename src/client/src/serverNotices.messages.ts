import { message } from "../../shared/localization";

export default {
  workspaceRemovalCommandFailed: message("Workspace removal failed. See terminal output.", "Workspace-removal command exited unsuccessfully; output contains the diagnostic"),
  workspaceRemovalFailed: message<{ detail: string }>("Workspace removal failed: {detail}", "Workspace removal could not start; detail is the unmodified server diagnostic"),
};
