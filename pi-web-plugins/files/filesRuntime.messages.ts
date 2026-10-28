import type { MessageDefinition } from "@chainingintention/pi-web-cn/plugin-api";

const text = (message: string, description: string): MessageDefinition<Record<string, never>> => ({ message, description });

export default {
  filesCapability: text("Files requires workspace-files capability v1. Update the PI WEB host.", "Files unavailable because the host lacks the required file capability"),
  navigationCapability: text("Files requires contribution navigation v1. Update the PI WEB host.", "Files unavailable because the host lacks contribution navigation"),
  capabilities: text("Files requires workspace-files capability v1 and contribution navigation v1. Update the PI WEB host.", "Files unavailable because required host capabilities are missing"),
  uploadCancelled: text("Upload cancelled", "Diagnostic for a cancelled upload batch or file"),
  uploadFailed: text("Workspace upload failed", "Fallback diagnostic for a failed upload"),
  notUploaded: text("Not uploaded.", "Diagnostic for a file not uploaded in a finished batch"),
  uploadsFailed: {
    message: "{count, plural, one {# file failed to upload} other {# files failed to upload}}",
    description: "Summary of the number of failed file uploads",
  } satisfies MessageDefinition<{ count: number }>,
  destinationEmpty: text("upload destination must not be empty", "Upload destination validation: empty path"),
  destinationRelative: text("upload destination must be workspace-relative", "Upload destination validation: absolute path"),
  destinationTraversal: text("upload destination must not contain path traversal", "Upload destination validation: parent-directory traversal"),
  nameEmpty: text("upload file name must not be empty", "Upload file name validation: empty path"),
  nameRelative: text("upload file name must be workspace-relative", "Upload file name validation: absolute path"),
  nameTraversal: text("upload file name must not contain path traversal", "Upload file name validation: parent-directory traversal"),
};
