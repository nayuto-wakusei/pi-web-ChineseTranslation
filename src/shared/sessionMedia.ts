/** Browser-only projection of an image; Pi runtime messages and transcripts keep their original data. */
export interface SessionMediaReference {
  type: "image";
  mediaId: string;
  mimeType: string;
  byteSize: number;
}

/** Explicit opt-in keeps older browser clients and remote machines compatible. */
export const SESSION_MEDIA_MODE = "reference";

export function isSessionMediaId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}
