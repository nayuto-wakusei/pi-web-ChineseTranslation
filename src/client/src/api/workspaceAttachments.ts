export const DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER = ".pi-web/attachments";

export interface WorkspaceAttachmentsFolderConfig {
  attachments?: {
    defaultFolder?: string;
  };
}

export function effectiveWorkspaceAttachmentsFolder(config: WorkspaceAttachmentsFolderConfig | undefined): string {
  return config?.attachments?.defaultFolder ?? DEFAULT_WORKSPACE_ATTACHMENTS_FOLDER;
}

export function workspaceEffectiveAttachmentsFolder(config: WorkspaceAttachmentsFolderConfig | undefined, fallbackFolder: string): string {
  return config?.attachments?.defaultFolder ?? fallbackFolder;
}
