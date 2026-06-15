import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";
import type { PromptAttachment, SavedPromptAttachment } from "../../shared/apiTypes.js";
import { extensionForImageMimeType } from "../../shared/promptAttachments.js";
import { normalizeRelativePath } from "../workspaces/pathSafety.js";

/**
 * Default workspace-relative folder used when saving pasted/dropped
 * attachments for the agent to read with its own tools.
 */
export const DEFAULT_ATTACHMENT_FOLDER = ".pi-web/paste";

export interface InlineImage {
  image: ImageContent;
  /** Optional human-readable dimension note produced by pi when resizing. */
  dimensionNote?: string;
}

/**
 * Convert validated attachments into pi-compatible inline image content.
 *
 * Mirrors pi's own CLI/TUI behaviour: each image is run through pi's
 * `resizeImage` so it fits within pi's max dimensions and inline byte budget
 * (2000x2000, ~4.5MB base64). Images that cannot be resized below the limit
 * are dropped, matching pi's `[Image omitted]` behaviour.
 */
export async function attachmentsToInlineImages(attachments: PromptAttachment[]): Promise<InlineImage[]> {
  const results: InlineImage[] = [];
  for (const attachment of attachments) {
    const bytes = Buffer.from(attachment.data, "base64");
    const resized = await resizeImage(bytes, attachment.mimeType);
    if (resized === null) continue;
    const note = formatDimensionNote(resized);
    results.push({
      image: { type: "image", data: resized.data, mimeType: resized.mimeType },
      ...(note === undefined ? {} : { dimensionNote: note }),
    });
  }
  return results;
}

export interface SaveAttachmentsOptions {
  /** Workspace-relative folder to write into. Defaults to `.pi-web/paste`. */
  folder?: string;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

/**
 * Write attachments into a workspace folder and return their relative paths.
 * Filenames are collision-safe and stay inside the workspace root.
 */
export async function saveAttachmentsToWorkspace(
  cwd: string,
  attachments: PromptAttachment[],
  options: SaveAttachmentsOptions = {},
): Promise<SavedPromptAttachment[]> {
  const folder = normalizeRelativePath(normalizeFolder(options.folder ?? DEFAULT_ATTACHMENT_FOLDER));
  const now = options.now ?? (() => new Date());
  const folderTarget = join(await realpath(cwd), folder);
  await mkdir(folderTarget, { recursive: true });

  const stamp = timestamp(now());
  const saved: SavedPromptAttachment[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const bytes = Buffer.from(attachment.data, "base64");
    const filename = `paste-${stamp}-${String(index + 1)}.${extensionForImageMimeType(attachment.mimeType)}`;
    const relativePath = `${folder}/${filename}`;
    await writeFile(join(folderTarget, filename), bytes);
    saved.push({ path: relativePath, mimeType: attachment.mimeType, size: bytes.byteLength });
  }
  return saved;
}

function normalizeFolder(folder: string): string {
  return folder.split(/[\\/]+/).filter((part) => part !== "" && part !== ".").join("/");
}

function timestamp(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}
