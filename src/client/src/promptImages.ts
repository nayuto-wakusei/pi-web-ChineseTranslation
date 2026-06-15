import type { PromptImage, PromptInput, SessionModel } from "../../shared/apiTypes";

export const DEFAULT_IMAGE_PROMPT_TEXT = "请看这张图片。";
export const MAX_PROMPT_IMAGES = 4;
export const SUPPORTED_PROMPT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export function modelSupportsImageInput(model: Pick<SessionModel, "input"> | undefined): boolean {
  return model?.input?.includes("image") === true;
}

export function isSupportedPromptImageMimeType(mimeType: string): boolean {
  return SUPPORTED_PROMPT_IMAGE_MIME_TYPES.some((supported) => supported === mimeType);
}

export async function promptImageFromFile(file: Pick<File, "type" | "arrayBuffer">): Promise<PromptImage> {
  if (!isSupportedPromptImageMimeType(file.type)) throw new Error(`Unsupported prompt image MIME type: ${file.type}`);
  return { type: "image", data: arrayBufferToBase64(await file.arrayBuffer()), mimeType: file.type };
}

export async function promptImagesFromClipboardItems(items: Iterable<Pick<DataTransferItem, "kind" | "type" | "getAsFile">>, limit = MAX_PROMPT_IMAGES): Promise<PromptImage[]> {
  const images: PromptImage[] = [];
  for (const item of items) {
    if (images.length >= limit) break;
    if (item.kind !== "file" || !isSupportedPromptImageMimeType(item.type)) continue;
    const file = item.getAsFile();
    if (file === null) continue;
    images.push(await promptImageFromFile(file));
  }
  return images;
}

export function promptInputFromDraft(draft: string, images: readonly PromptImage[]): string | PromptInput {
  const text = draft.trim();
  if (images.length === 0) return text;
  return { text: text === "" ? DEFAULT_IMAGE_PROMPT_TEXT : text, images: [...images] };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
