/** HTTP metadata shared by authoritative resource dispatch and every proxy edge. */
export interface PluginResourceMetadata {
  readonly contentType: string;
  readonly statusCode: 200 | 206 | 416;
  readonly contentLength?: number;
  readonly contentRange?: string;
  readonly acceptRanges?: "bytes";
}

/** Parse only the response fields plugins are allowed to control. */
export function parsePluginResourceMetadata(value: unknown): PluginResourceMetadata {
  if (typeof value !== "object" || value === null) throw new Error("Missing resource metadata");
  const contentType: unknown = Reflect.get(value, "contentType");
  const declaredLength: unknown = Reflect.get(value, "contentLength");
  const status: unknown = Reflect.get(value, "statusCode");
  const statusCode = status === undefined ? 200 : status;
  const contentRange: unknown = Reflect.get(value, "contentRange");
  const acceptRanges: unknown = Reflect.get(value, "acceptRanges");
  // RFC tokens and quoted parameters, with no non-ASCII bytes or header controls.
  const mime = /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+(?:[ \t]*;[ \t]*[!#$%&'*+.^_`|~\w-]+=(?:[!#$%&'*+.^_`|~\w-]+|"(?:[^"\\]|\\[ -~])*"))*$/u;
  if (typeof contentType !== "string" || contentType.length > 1024 || !mime.test(contentType)
    || Array.from(contentType).some((char) => (char.charCodeAt(0) < 32 && char !== "\t") || char.charCodeAt(0) > 126)) {
    throw new Error("Invalid resource content type");
  }
  if (declaredLength !== undefined && (typeof declaredLength !== "number" || !Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
    throw new Error("Invalid resource content length");
  }
  let contentLength = declaredLength;
  if (statusCode !== 200 && statusCode !== 206 && statusCode !== 416) throw new Error("Invalid resource status code");
  if (acceptRanges !== undefined && acceptRanges !== "bytes") throw new Error("Invalid resource accept ranges");
  if (statusCode === 200 && contentRange !== undefined) throw new Error("Unexpected resource content range");
  if (statusCode !== 200) {
    if (typeof contentRange !== "string" || contentRange.length > 128) throw new Error("Missing resource content range");
    if (statusCode === 416) {
      const match = /^bytes \*\/(\d+)$/u.exec(contentRange);
      if (match === null || !Number.isSafeInteger(Number(match[1]))) throw new Error("Invalid unsatisfied resource range");
    } else {
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(contentRange);
      if (match === null) throw new Error("Invalid partial resource range");
      const start = Number(match[1]);
      const end = Number(match[2]);
      const total = match[3] === "*" ? undefined : Number(match[3]);
      const rangeLength = end - start + 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(rangeLength) || start > end
        || (total !== undefined && (!Number.isSafeInteger(total) || total <= end))
        || (contentLength !== undefined && contentLength !== rangeLength)) throw new Error("Inconsistent resource range");
      // A single byte range defines its length even when a plugin omits the field.
      contentLength = rangeLength;
    }
  }
  return {
    contentType, statusCode,
    ...(contentLength === undefined ? {} : { contentLength }),
    ...(typeof contentRange === "string" ? { contentRange } : {}),
    ...(acceptRanges === undefined ? {} : { acceptRanges }),
  };
}
