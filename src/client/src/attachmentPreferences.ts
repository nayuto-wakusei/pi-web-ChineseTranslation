import type { PromptAttachmentDelivery } from "../../shared/apiTypes";
import { browserStorage } from "./browserStorage";

const storageKey = "pi-web:attachment-delivery";

export function loadAttachmentDelivery(storage = browserStorage()): PromptAttachmentDelivery {
  try {
    return storage?.getItem(storageKey) === "folder" ? "folder" : "inline";
  } catch {
    return "inline";
  }
}

export function saveAttachmentDelivery(mode: PromptAttachmentDelivery, storage = browserStorage()): void {
  try {
    storage?.setItem(storageKey, mode);
  } catch {
    // Ignore localStorage quota/privacy errors.
  }
}
