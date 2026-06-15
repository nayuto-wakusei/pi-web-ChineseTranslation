import type { PromptAttachment } from "./apiTypes.js";

/**
 * Image mime types supported by the pi coding agent. Mirrors
 * `detectSupportedImageMimeType` in `@earendil-works/pi-coding-agent`.
 */
export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export type SupportedImageMimeType = typeof SUPPORTED_IMAGE_MIME_TYPES[number];

const supportedImageMimeTypes: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MIME_TYPES);

/**
 * Maximum base64 payload per image. Matches pi's `DEFAULT_MAX_BYTES`
 * (4.5MB, headroom below Anthropic's 5MB inline image limit). pi resizes
 * images down to this size; we validate against it as the hard upper bound.
 */
export const MAX_INLINE_IMAGE_BASE64_BYTES = Math.round(4.5 * 1024 * 1024);

/** Maximum number of attachments allowed on a single prompt. */
export const MAX_PROMPT_ATTACHMENTS = 16;

export function isSupportedImageMimeType(value: unknown): value is SupportedImageMimeType {
  return typeof value === "string" && supportedImageMimeTypes.has(value);
}

export function extensionForImageMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    default: return "bin";
  }
}

const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export interface AttachmentValidationOptions {
  /** When true, enforce the per-image base64 size cap (inline delivery). */
  enforceInlineSizeLimit?: boolean;
  maxAttachments?: number;
}

/**
 * Validate and normalize untrusted prompt attachments. Throws on malformed,
 * unsupported, or oversized input so routes can return a 400.
 */
export function parsePromptAttachments(value: unknown, options: AttachmentValidationOptions = {}): PromptAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("attachments must be an array");
  const maxAttachments = options.maxAttachments ?? MAX_PROMPT_ATTACHMENTS;
  if (value.length > maxAttachments) throw new Error(`too many attachments (max ${String(maxAttachments)})`);
  return value.map((entry, index) => parsePromptAttachment(entry, index, options));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePromptAttachment(value: unknown, index: number, options: AttachmentValidationOptions): PromptAttachment {
  if (!isRecord(value)) throw new Error(`attachment ${String(index)} must be an object`);
  const record = value;
  const kind = record["kind"];
  if (kind !== "image") throw new Error(`attachment ${String(index)} has unsupported kind`);
  const mimeType = record["mimeType"];
  if (!isSupportedImageMimeType(mimeType)) throw new Error(`attachment ${String(index)} has unsupported image type`);
  const data = record["data"];
  if (typeof data !== "string" || data === "" || !base64Pattern.test(data)) throw new Error(`attachment ${String(index)} has invalid base64 data`);
  if (options.enforceInlineSizeLimit === true && base64ByteLength(data) > MAX_INLINE_IMAGE_BASE64_BYTES) {
    throw new Error(`attachment ${String(index)} exceeds the inline image size limit`);
  }
  const name = record["name"];
  return {
    kind: "image",
    mimeType,
    data,
    ...(typeof name === "string" && name !== "" ? { name } : {}),
  };
}
