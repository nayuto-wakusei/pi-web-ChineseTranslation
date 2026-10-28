export interface ByteRange { start: number; end: number }

/** Invalid, multipart and unsatisfiable ranges all produce a bounded 416 response. */
export function parseByteRange(header: string, size: number): ByteRange | undefined {
  if (!Number.isSafeInteger(size) || size <= 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (match?.[0] !== header || (match[1] === "" && match[2] === "")) return undefined;
  const first = match[1] === "" ? undefined : Number(match[1]);
  const last = match[2] === "" ? undefined : Number(match[2]);
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) return undefined;
  if (first === undefined) {
    if (last === undefined || last === 0) return undefined;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return undefined;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
