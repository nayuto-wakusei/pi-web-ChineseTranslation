import type { SessionContentSearchExcerpt, SessionContentSearchMatch } from "../../shared/apiTypes.js";
import { buildTranscriptView } from "./subsessionTranscript.js";

const EXCERPT_CONTEXT_CHARS = 72;
const MAX_EXCERPT_OCCURRENCES = 20;

export interface SessionContentSearchView {
  matches: SessionContentSearchMatch[];
  matchCount: number;
}

export function searchSessionContent(messages: readonly unknown[], query: string, limit: number): SessionContentSearchView {
  const view = buildTranscriptView(messages, {
    roles: ["user", "assistant"],
    include: ["text"],
    search: query,
    limit,
  });
  const matches = view.entries
    .map((entry): SessionContentSearchMatch | undefined => {
      if (entry.role !== "user" && entry.role !== "assistant") return undefined;
      const texts = entry.parts.flatMap((part) => part.kind === "text" ? [part.text] : []);
      const occurrenceCount = texts.reduce((count, text) => count + findMatchRanges(text, query).length, 0);
      if (occurrenceCount === 0) return undefined;
      return {
        messageIndex: entry.index,
        role: entry.role,
        excerpts: buildExcerpts(texts, query),
        occurrenceCount,
      };
    })
    .filter((match): match is SessionContentSearchMatch => match !== undefined)
    .reverse();
  return { matches, matchCount: view.matched };
}

export function findMatchRanges(text: string, query: string): { start: number; length: number }[] {
  const needle = query.trim();
  if (needle === "") return [];
  const pattern = new RegExp(escapeRegExp(needle), "giu");
  const ranges: { start: number; length: number }[] = [];
  for (const match of text.matchAll(pattern)) {
    ranges.push({ start: match.index, length: match[0].length });
  }
  return ranges;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildExcerpts(texts: readonly string[], query: string): SessionContentSearchExcerpt[] {
  const excerpts: SessionContentSearchExcerpt[] = [];
  let remaining = MAX_EXCERPT_OCCURRENCES;
  for (const text of texts) {
    if (remaining === 0) break;
    const ranges = findMatchRanges(text, query).slice(0, remaining);
    remaining -= ranges.length;
    excerpts.push(...mergeExcerptWindows(text, ranges));
  }
  return excerpts;
}

function mergeExcerptWindows(text: string, ranges: readonly { start: number; length: number }[]): SessionContentSearchExcerpt[] {
  const windows: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const start = Math.max(0, range.start - EXCERPT_CONTEXT_CHARS);
    const end = Math.min(text.length, range.start + range.length + EXCERPT_CONTEXT_CHARS);
    const previous = windows.at(-1);
    if (previous !== undefined && start <= previous.end) previous.end = Math.max(previous.end, end);
    else windows.push({ start, end });
  }
  return windows.map((window) => ({
    text: `${window.start > 0 ? "…" : ""}${text.slice(window.start, window.end)}${window.end < text.length ? "…" : ""}`,
    matchRanges: ranges
      .filter((range) => range.start < window.end && range.start + range.length > window.start)
      .map((range) => ({ start: range.start - window.start + (window.start > 0 ? 1 : 0), length: range.length })),
  }));
}
