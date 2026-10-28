export const audioMimeTypes: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/ogg",
} as const;

export function audioContentType(path: string): string | undefined {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? undefined : name.slice(dot + 1).toLowerCase();
  return extension !== undefined && Object.hasOwn(audioMimeTypes, extension)
    ? audioMimeTypes[extension]
    : undefined;
}
