import { extensionForImageMimeType, isSupportedImageMimeType } from "../../shared/promptAttachments";

/**
 * Minimal view of a browser File needed to capture an attachment. Keeping this
 * structural (rather than depending on the DOM `File` type) lets the capture
 * logic be unit-tested without a browser environment.
 */
export interface CapturableFile {
  name: string;
  type: string;
  size: number;
}

export interface CapturedAttachment {
  name: string;
  mimeType: string;
  /** Base64 payload without the data: URL prefix. */
  data: string;
  size: number;
}

export interface CaptureResult {
  attachments: CapturedAttachment[];
  error?: string;
}

export const UNSUPPORTED_IMAGE_MESSAGE = "Only PNG, JPEG, GIF, and WebP images are supported.";
export const READ_FAILURE_MESSAGE = "Failed to read an attachment.";

/**
 * Validate a batch of files and read the supported images as base64.
 *
 * Pure orchestration: the actual byte reading is injected so the side effect
 * (FileReader/Blob access) stays at the component boundary and tests can supply
 * a fake reader. Unsupported types and read failures are collected into a single
 * user-facing error while still returning every attachment that did succeed.
 */
export async function captureImageAttachments<T extends CapturableFile>(
  files: readonly T[],
  readBase64: (file: T) => Promise<string>,
): Promise<CaptureResult> {
  const attachments: CapturedAttachment[] = [];
  let error: string | undefined;
  for (const file of files) {
    if (!isSupportedImageMimeType(file.type)) {
      error = UNSUPPORTED_IMAGE_MESSAGE;
      continue;
    }
    try {
      const data = await readBase64(file);
      attachments.push({ name: attachmentName(file), mimeType: file.type, data, size: file.size });
    } catch {
      error = READ_FAILURE_MESSAGE;
    }
  }
  return { attachments, ...(error === undefined ? {} : { error }) };
}

function attachmentName(file: CapturableFile): string {
  return file.name !== "" ? file.name : `pasted-image.${extensionForImageMimeType(file.type)}`;
}
