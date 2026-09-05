import type { CapturedAttachment } from "./promptAttachmentCapture";

/** A captured attachment staged in the composer, tagged with a stable id for chip removal/rendering. */
export type PendingAttachment = CapturedAttachment & { id: string };

export type StagedAttachmentStore = Map<string, readonly PendingAttachment[]>;

const sharedStore: StagedAttachmentStore = new Map();

export function loadStagedAttachments(key: string, store: StagedAttachmentStore = sharedStore): readonly PendingAttachment[] {
  return store.get(key) ?? [];
}

export function saveStagedAttachments(key: string, attachments: readonly PendingAttachment[], store: StagedAttachmentStore = sharedStore): void {
  if (attachments.length > 0) store.set(key, attachments);
  else store.delete(key);
}

export function clearStagedAttachments(key: string, store: StagedAttachmentStore = sharedStore): void {
  store.delete(key);
}

export function moveStagedAttachments(fromKey: string, toKey: string, store: StagedAttachmentStore = sharedStore): void {
  const attachments = store.get(fromKey);
  if (attachments === undefined) return;
  store.set(toKey, attachments);
  store.delete(fromKey);
}
