import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PiWebServerPluginV5, ServerPluginPeerResourceContextV5, ServerPluginResourceResponse } from "@chainingintention/pi-web-cn/server-plugin-api";
import { audioContentType } from "./audioFormats.js";
import { parseByteRange } from "./byteRange.js";

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/** Reads only the host-resolved workspace; browser selectors never supply authority. */
export async function readAudioResource(context: ServerPluginPeerResourceContextV5): Promise<ServerPluginResourceResponse> {
  const { scope, operation, input, signal, range } = context;
  signal.throwIfAborted();
  if (operation !== "audio.read" || scope.kind !== "workspace") throw new Error("Audio requires a workspace resource");
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || Object.keys(input).length !== 1 || !("path" in input)
    || typeof input["path"] !== "string") throw new Error("Invalid audio path");
  const inputPath = input["path"];
  if (inputPath.length === 0 || inputPath.length > 4096 || inputPath.includes("\0")
    || inputPath.split(/[\\/]/).includes("..")) throw new Error("Invalid audio path");
  const contentType = audioContentType(inputPath);
  if (contentType === undefined) throw new Error("Unsupported audio file");
  const root = await realpath(scope.workspace.path);
  const path = await realpath(resolve(root, inputPath));
  if (!within(root, path)) throw new Error("Audio path is outside the workspace");
  signal.throwIfAborted();
  // O_NONBLOCK prevents a FIFO named *.mp3 from hanging before fstat rejects it.
  // O_NOFOLLOW prevents swapping the validated final component for a symlink.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  let transferred = false;
  try {
    signal.throwIfAborted();
    const stat = await handle.stat();
    signal.throwIfAborted();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new Error("Audio must be a regular file with a supported size");
    const selected = range === undefined ? { start: 0, end: stat.size - 1 } : parseByteRange(range, stat.size);
    if (selected === undefined) return { body: new Uint8Array(), contentType, statusCode: 416, contentLength: 0, contentRange: `bytes */${String(stat.size)}`, acceptRanges: "bytes" };
    const contentLength = selected.end - selected.start + 1;
    const metadata = {
      contentType, contentLength, acceptRanges: "bytes" as const,
      statusCode: range === undefined ? 200 as const : 206 as const,
      ...(range === undefined ? {} : { contentRange: `bytes ${String(selected.start)}-${String(selected.end)}/${String(stat.size)}` }),
    };
    signal.throwIfAborted();
    if (contentLength === 0) return { ...metadata, body: new Uint8Array() };
    const stream = handle.createReadStream({ start: selected.start, end: selected.end, autoClose: true, signal });
    // Cancellation may precede transport consumption; always observe stream errors.
    stream.on("error", () => { /* The async iterator propagates read failures to the host. */ });
    transferred = true;
    return { ...metadata, body: stream };
  } finally {
    if (!transferred) await handle.close();
  }
}

const plugin = {
  apiVersion: 5,
  name: "Audio",
  activate: () => ({ peer: { resource: readAudioResource } }),
} satisfies PiWebServerPluginV5;

export default plugin;
