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

/** Exact basenames win before longest dot-prefixed suffix; ties keep the first declared rule.
 * This resolves files only: callers retain their directory indicators/arrows.
 */
export function resolveFileIcon(theme: FileIconThemeContribution, path: string, colorScheme: ThemeColorScheme): string {
  const basename = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  const assetUrl = (asset: FileIconAsset) => colorScheme === "light" ? asset.lightUrl ?? asset.url : asset.url;
  for (const rule of theme.files ?? []) {
    if (rule.filenames?.some((name) => name.toLowerCase() === basename) === true) return assetUrl(rule.icon);
  }
  let icon = theme.file;
  let longest = 0;
  for (const rule of theme.files ?? []) {
    for (const extension of rule.extensions ?? []) {
      if (extension.length > longest && basename.endsWith(extension.toLowerCase())) {
        icon = rule.icon;
        longest = extension.length;
      }
    }
  }
  return assetUrl(icon);
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
