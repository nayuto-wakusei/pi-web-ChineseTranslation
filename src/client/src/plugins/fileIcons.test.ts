import { describe, expect, it } from "vitest";
import { resolveFileIcon, snapshotFileIconTheme } from "./fileIcons";

const asset = (name: string) => ({ url: `https://icons.test/${name}.svg` });
const declaration = {
  id: "files", name: "Files", file: { ...asset("default"), lightUrl: "https://icons.test/default-light.svg" },
  files: [
    { extensions: [".ts"], icon: asset("ts") },
    { extensions: [".d.ts"], icon: asset("declaration") },
    { extensions: [".D.TS"], icon: asset("later-extension") },
    { filenames: ["SPECIAL.D.TS", "Makefile"], icon: { ...asset("exact"), lightUrl: "https://icons.test/exact-light.svg" } },
    { filenames: ["special.d.ts"], icon: asset("later-filename") },
  ],
};

describe("file icon resolution", () => {
  const theme = snapshotFileIconTheme(declaration);
  it.each([
    ["/dir/SPECIAL.d.ts", "exact"],
    ["C:\\dir\\makeFILE", "exact"],
    ["/dir/types.D.TS", "declaration"],
    ["/dir/code.TS", "ts"],
    ["/dir/.ts", "ts"],
    ["/dir/Makefile.ts", "ts"],
    ["/dir/unknown", "default"],
    ["/dir/foo.ts.txt", "default"],
  ])("resolves %s by filename, longest extension, then fallback", (path, name) => {
    expect(resolveFileIcon(theme, path, "dark")).toBe(asset(name).url);
  });
  it("uses light assets when available and falls back to the ordinary asset", () => {
    expect(resolveFileIcon(theme, "special.d.ts", "light")).toBe("https://icons.test/exact-light.svg");
    expect(resolveFileIcon(theme, "other", "light")).toBe("https://icons.test/default-light.svg");
    expect(resolveFileIcon(theme, "code.ts", "light")).toBe(asset("ts").url);
  });
});

describe("file icon snapshots", () => {
  it("detaches and deeply freezes all accepted values", () => {
    const source = structuredClone(declaration);
    const snapshot = snapshotFileIconTheme(source);
    source.file.url = asset("changed").url;
    const rule = source.files[0];
    if (rule?.extensions === undefined) throw new Error("Missing extension rule");
    rule.extensions[0] = ".changed";
    rule.icon.url = asset("changed").url;
    expect(resolveFileIcon(snapshot, "code.ts", "dark")).toBe(asset("ts").url);
    expect(snapshot.file.url).toBe(asset("default").url);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.file)).toBe(true);
    expect(Object.isFrozen(snapshot.files)).toBe(true);
    expect(Object.isFrozen(snapshot.files?.[0])).toBe(true);
    expect(Object.isFrozen(snapshot.files?.[0]?.extensions)).toBe(true);
    expect(Object.isFrozen(snapshot.files?.[0]?.icon)).toBe(true);
  });

  it.each([
    null,
    { ...declaration, id: "bad:id" },
    { ...declaration, name: " " },
    { ...declaration, description: 12 },
    { ...declaration, order: NaN },
    { ...declaration, order: Infinity },
    { ...declaration, file: { url: "<svg/>" } },
    { ...declaration, file: { url: "data:image/svg+xml,<svg/>" } },
    { ...declaration, file: { url: "javascript:alert(1)" } },
    { ...declaration, file: { url: "/icons/file.svg" } },
    { ...declaration, file: { url: "//icons.test/file.svg" } },
    { ...declaration, file: { url: "https://" } },
    { ...declaration, file: { ...asset("file"), lightUrl: "file:///tmp/icon.svg" } },
    { ...declaration, files: {} },
    { ...declaration, files: [null] },
    { ...declaration, files: [{ icon: asset("file") }] },
    { ...declaration, files: [{ filenames: ["dir/name"], icon: asset("file") }] },
    { ...declaration, files: [{ filenames: [""], icon: asset("file") }] },
    { ...declaration, files: [{ extensions: ["ts"], icon: asset("file") }] },
    { ...declaration, files: [{ extensions: ["."], icon: asset("file") }] },
    { ...declaration, files: [{ extensions: [".ts"], icon: { url: "<svg/>" } }] },
  ])("rejects malformed or unsafe declarations: %j", (value) => {
    expect(() => snapshotFileIconTheme(value)).toThrow();
  });

  it("accepts HTTP assets and an empty rule list", () => {
    expect(snapshotFileIconTheme({ id: "files", name: "Files", file: { url: "http://icons.test/file.svg" }, files: [] }).file.url)
      .toBe("http://icons.test/file.svg");
  });
});
