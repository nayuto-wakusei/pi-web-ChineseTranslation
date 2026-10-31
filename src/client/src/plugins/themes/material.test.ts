// @vitest-environment happy-dom
import { readFile, readdir } from "node:fs/promises";
import { basename } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFileIcon } from "../fileIcons";
import { PluginRegistry } from "../registry";
import type { FileIconThemeContribution } from "../types";
import { themePackPlugin } from "./index";
import { materialFileIcons } from "./material/generated";

const registries: PluginRegistry[] = [];
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.dispose();
});

const material: FileIconThemeContribution = { id: "material", name: "Material", ...materialFileIcons };
const assetName = (url: string) => basename(new URL(url).pathname);

describe("bundled Material file icons", () => {
  it("contributes the stable themes:material identity through the bundled plugin", async () => {
    const registry = new PluginRegistry();
    registries.push(registry);
    await registry.register({ id: "themes", plugin: themePackPlugin });
    const themes = registry.getFileIconThemes();
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ id: "themes:material", name: "Material", file: material.file });
  });

  it.each([
    ["package.json", "nodejs.svg"],
    ["Dockerfile", "docker.svg"],
    ["README.md", "readme.svg"],
    [".gitignore", "git.svg"],
    ["src/app.ts", "typescript.svg"],
    ["src/app.test.ts", "test-ts.svg"],
    ["src/view.tsx", "react_ts.svg"],
    ["src/main.py", "python.svg"],
    ["src/lib.rs", "rust.svg"],
    ["image.svg", "svg.svg"],
    ["unrecognized.zzz-unknown", "file.svg"],
    ["no-extension", "file.svg"],
  ])("resolves %s to %s", (path, expected) => {
    expect(assetName(resolveFileIcon(material, path, "dark"))).toBe(expected);
  });

  it("uses the same extension-specific mask shapes in light and dark themes", () => {
    const samples: [string, string][] = [["next.config.ts", "next.svg"], ["config.toml", "toml.svg"], ["main.ts", "typescript.svg"]];
    for (const [path, expected] of samples) {
      expect(assetName(resolveFileIcon(material, path, "dark"))).toBe(expected);
      expect(resolveFileIcon(material, path, "light")).toBe(resolveFileIcon(material, path, "dark"));
    }
    expect(resolveFileIcon(material, "unknown", "light")).toBe(material.file.url);
  });

  it("generates a broad, entirely local static SVG set with packaged license notices", async () => {
    const rules = material.files ?? [];
    expect(rules.flatMap((rule) => rule.filenames ?? []).length).toBeGreaterThan(1900);
    expect(rules.flatMap((rule) => rule.extensions ?? []).length).toBeGreaterThan(1300);
    const assets = [material.file, ...rules.map((rule) => rule.icon)];
    expect(assets.every((asset) => asset.lightUrl === undefined)).toBe(true);
    const urls = new Set(assets.flatMap(({ url, lightUrl }) => lightUrl === undefined ? [url] : [url, lightUrl]));
    const filenames = new Set<string>();
    for (const value of urls) {
      const url = new URL(value);
      expect(url.origin).toBe(window.location.origin);
      expect(url.pathname).toContain("/themes/material/icons/");
      expect(url.search).toBe("?no-inline");
      const filename = assetName(value);
      filenames.add(filename);
      const svg = await readFile(`src/client/src/plugins/themes/material/icons/${filename}`, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("Material Icon Theme");
      expect(svg).not.toMatch(/<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#)/iu);
    }
    expect(filenames.size).toBeGreaterThan(500);
    expect([...filenames].every((filename) => !filename.endsWith("_light.svg"))).toBe(true);
    expect([...filenames].sort()).toEqual((await readdir("src/client/src/plugins/themes/material/icons")).sort());
    const fallback = await readFile("src/client/src/plugins/themes/material/icons/file.svg", "utf8");
    expect(fallback).toContain("Permission is hereby granted, free of charge");
    expect(fallback).toContain("Apache License");
    expect(fallback).toContain("Version 2.0, January 2004");
  });
});
