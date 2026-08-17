#!/usr/bin/env node
// Assemble the development documentation variant under docs/.deploy/dev.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(scriptDir, "../docs");
const outDir = path.join(docsDir, ".deploy/dev");
const pagesDir = path.join(outDir, "dev");
const excludedEntries = new Set(["_redirects", "404.html", "robots.txt", "sitemap.xml", "wrangler.jsonc"]);

function resolveGitSha() {
  const fromEnv = (process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(fromEnv)) return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: docsDir, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function stableUrlFor(htmlFileName) {
  if (htmlFileName === "index.html") return "https://pi-web.dev/";
  return `https://pi-web.dev/${htmlFileName.replace(/\.html$/, "")}`;
}

function bannerHtml(sha, stableUrl) {
  const source = sha
    ? `<a href="https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/commit/${sha}" style="color:inherit;text-decoration:underline;">main@${sha.slice(0, 7)}</a>`
    : "the main branch";
  return (
    `<div class="dev-docs-banner">Development docs built from ${source} — content may not match the latest release. ` +
    `<a href="${stableUrl}">View stable version →</a></div>`
  );
}

function activateDevVersion(html) {
  const stableOption = /(<a\b[^>]*data-version-option="stable"[^>]*?) aria-current="true"/;
  const devOption = /(<a\b[^>]*data-version-option="dev"[^>]*?)>/;
  if (!stableOption.test(html) || !devOption.test(html)) {
    throw new Error("Expected footer version switcher options to flip the active version.");
  }
  return html.replace(stableOption, "$1").replace(devOption, '$1 aria-current="true">');
}

function injectDevMarkers(html, banner) {
  if (!html.includes("<head>")) throw new Error("Expected a <head> tag to inject the noindex meta tag.");
  if (!/<body[^>]*>/.test(html)) throw new Error("Expected a <body> tag to inject the dev banner.");
  return html
    .replace("<head>", '<head>\n    <meta name="robots" content="noindex" />')
    .replace(/<body[^>]*>/, (bodyTag) => `${bodyTag}\n    ${banner}`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });

for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
  if (entry.name.startsWith(".") || excludedEntries.has(entry.name)) continue;
  cpSync(path.join(docsDir, entry.name), path.join(pagesDir, entry.name), { recursive: true });
}

cpSync(path.join(docsDir, "404.html"), path.join(outDir, "404.html"));

const sha = resolveGitSha();
const htmlPages = readdirSync(pagesDir).filter((name) => name.endsWith(".html"));
for (const page of htmlPages) {
  const pagePath = path.join(pagesDir, page);
  const html = readFileSync(pagePath, "utf8");
  writeFileSync(pagePath, activateDevVersion(injectDevMarkers(html, bannerHtml(sha, stableUrlFor(page)))));
}

writeFileSync(path.join(outDir, "_redirects"), "/dev/index.html /dev/ 301\n");
console.log(`Assembled dev docs at ${path.relative(process.cwd(), outDir)} (${htmlPages.length} pages).`);
