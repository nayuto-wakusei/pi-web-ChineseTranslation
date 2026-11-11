import type { FileIconAsset, FileIconThemeContribution, ThemeColorScheme } from "./types";

/** Validate untrusted declarations and detach/freeze every nested value before publication. */
export function snapshotFileIconTheme(value: unknown): FileIconThemeContribution {
  if (!isRecord(value)) throw new Error("File icon theme must be an object");
  const { id, name, description, order, file, files } = value;
  if (typeof id !== "string" || !/^[a-z][a-z0-9.-]*$/u.test(id)) throw new Error("Invalid file icon theme id");
  if (typeof name !== "string" || name.trim() === "") throw new Error(`File icon theme ${id} requires a name`);
  if (description !== undefined && typeof description !== "string") throw new Error(`File icon theme ${id} description must be a string`);
  if (order !== undefined && (typeof order !== "number" || !Number.isFinite(order))) throw new Error(`File icon theme ${id} order must be finite`);
  if (files !== undefined && !Array.isArray(files)) throw new Error(`File icon theme ${id} files must be an array`);
  const rules = files?.map((rule: unknown) => {
    if (!isRecord(rule)) throw new Error(`File icon theme ${id} rule must be an object`);
    const filenames = snapshotMatchers(rule["filenames"], false);
    const extensions = snapshotMatchers(rule["extensions"], true);
    if ((filenames?.length ?? 0) + (extensions?.length ?? 0) === 0) throw new Error(`File icon theme ${id} rule requires filenames or extensions`);
    return Object.freeze({
      ...(filenames === undefined ? {} : { filenames }),
      ...(extensions === undefined ? {} : { extensions }),
      icon: snapshotAsset(rule["icon"]),
    });
  });
  return Object.freeze({
    id, name,
    ...(description === undefined ? {} : { description }),
    ...(order === undefined ? {} : { order }),
    file: snapshotAsset(file),
    ...(rules === undefined ? {} : { files: Object.freeze(rules) }),
  });
}

/** Index the selected theme once; each row only checks its basename and dot suffixes. */
export function createFileIconResolver(theme: FileIconThemeContribution): (path: string, colorScheme: ThemeColorScheme) => string {
  const filenames = new Map<string, FileIconAsset>();
  const extensions = new Map<string, { icon: FileIconAsset; length: number; order: number }>();
  for (const [order, rule] of (theme.files ?? []).entries()) {
    for (const filename of rule.filenames ?? []) {
      const key = filename.toLowerCase();
      if (!filenames.has(key)) filenames.set(key, rule.icon);
    }
    for (const extension of rule.extensions ?? []) {
      const key = extension.toLowerCase();
      const previous = extensions.get(key);
      if (previous === undefined || extension.length > previous.length) extensions.set(key, { icon: rule.icon, length: extension.length, order });
    }
  }

  return (path, colorScheme) => {
    const basename = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).toLowerCase();
    let icon = filenames.get(basename);
    if (icon === undefined) {
      let best: { icon: FileIconAsset; length: number; order: number } | undefined;
      for (let dot = basename.indexOf("."); dot !== -1; dot = basename.indexOf(".", dot + 1)) {
        const match = extensions.get(basename.slice(dot));
        // Lowercasing can expand Unicode, so compare original lengths and declaration order.
        if (match !== undefined && (best === undefined || match.length > best.length || (match.length === best.length && match.order < best.order))) best = match;
      }
      icon = best?.icon ?? theme.file;
    }
    return colorScheme === "light" ? icon.lightUrl ?? icon.url : icon.url;
  };
}

function snapshotAsset(value: unknown): FileIconAsset {
  if (!isRecord(value)) throw new Error("File icon asset must be an object");
  return Object.freeze({ url: assetUrl(value["url"]), ...(value["lightUrl"] === undefined ? {} : { lightUrl: assetUrl(value["lightUrl"]) }) });
}

function assetUrl(value: unknown): string {
  if (typeof value !== "string" || !/^https?:\/\//iu.test(value)) throw new Error("File icon asset requires an absolute HTTP(S) URL");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("File icon asset requires an absolute HTTP(S) URL");
  return url.href;
}

function snapshotMatchers(value: unknown, extension: boolean): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry: unknown) => typeof entry !== "string" || entry.trim() === "" || /[\\/]/u.test(entry)
    || (extension && (!entry.startsWith(".") || entry.length < 2)))) {
    throw new Error(extension ? "File icon extensions must be dot-prefixed suffixes" : "File icon filenames must be basenames");
  }
  return Object.freeze(value.map((entry: string) => entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
