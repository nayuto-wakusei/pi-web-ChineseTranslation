import type { SessionContentSearchExcerpt, SessionContentSearchMatch } from "../../shared/apiTypes.js";
import { distance } from "fastest-levenshtein";

const EXCERPT_CONTEXT_CHARS = 72;
const MAX_EXCERPT_OCCURRENCES = 20;

export interface SessionContentSearchView {
  matches: (SessionContentSearchMatch & { rank: number })[];
  matchCount: number;
}

interface MatchRange { start: number; length: number }
interface MatchedText { text: string; ranges: MatchRange[] }
interface ContentMatch { rank: number; parts: MatchedText[] }

export function compileSessionContentQuery(query: string): (texts: readonly string[]) => ContentMatch | undefined {
  const needle = query.trim();
  const phrase = new RegExp(escapeRegExp(needle), "giu");
  const terms = [...new Set(needle.toLowerCase().split(/\s+/u))].map((value) => ({
    value,
    pattern: new RegExp(escapeRegExp(value), "giu"),
    fuzzy: /^[a-z]{4,64}$/u.test(value) ? new RegExp(`\\b[a-z]{${String(value.length - 1)},${String(value.length + 1)}}\\b`, "gi") : undefined,
    typoCache: new Map<string, boolean>(),
  }));
  const singleTermPhrase = terms.length === 1 && terms[0]?.value === needle;
  let cachedTypos = 0;
  return (texts) => {
    if (needle === "") return undefined;
    const exact = texts.map((text) => ({ text, ranges: rangesForPattern(text, phrase) }));
    if (exact.some((part) => part.ranges.length > 0)) return { rank: 0, parts: exact };
    const parts: MatchedText[] = texts.map((text) => ({ text, ranges: [] }));
    let rank = 1;
    for (const term of terms) {
      // A single-term phrase already failed the identical literal scan above.
      let ranges = singleTermPhrase ? texts.map((): MatchRange[] => []) : texts.map((text) => rangesForPattern(text, term.pattern));
      if (!ranges.some((matches) => matches.length > 0)) {
        if (term.fuzzy === undefined) return undefined;
        // Bound typo work to short ASCII words; punctuation and CJK stay literal.
        const pattern = term.fuzzy;
        ranges = texts.map((text) => {
          const matches: MatchRange[] = [];
          for (const word of text.matchAll(pattern)) {
            const value = word[0].toLowerCase();
            let matchesTypo = term.typoCache.get(value);
            if (matchesTypo === undefined) {
              matchesTypo = distance(value, term.value) <= 1;
              if (cachedTypos < 4096) {
                term.typoCache.set(value, matchesTypo);
                cachedTypos++;
              }
            }
            if (matchesTypo) matches.push({ start: word.index, length: word[0].length });
          }
          return matches;
        });
        if (!ranges.some((matches) => matches.length > 0)) return undefined;
        rank = 2;
      }
      parts.forEach((part, index) => part.ranges.push(...(ranges[index] ?? [])));
    }
    for (const part of parts) part.ranges = mergeMatchRanges(part.ranges);
    return { rank, parts };
  };
}

export function searchSessionContent(messages: readonly unknown[], query: string | ReturnType<typeof compileSessionContentQuery>, limit: number): SessionContentSearchView {
  const matchText = typeof query === "string" ? compileSessionContentQuery(query) : query;
  const maxMatches = Math.max(1, Math.min(200, Math.floor(limit)));
  const buckets: { messageIndex: number; role: "user" | "assistant"; content: ContentMatch }[][] = [[], [], []];
  let matchCount = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!isRecord(message) || (message["role"] !== "user" && message["role"] !== "assistant")) continue;
    const content = message["content"];
    const texts = typeof content === "string" ? [content] : Array.isArray(content)
      ? content.flatMap((part: unknown) => isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" ? [part["text"]] : [])
      : [];
    const match = matchText(texts);
    if (match === undefined) continue;
    matchCount++;
    const bucket = buckets[match.rank];
    if (bucket !== undefined && bucket.length < maxMatches) bucket.push({ messageIndex: index, role: message["role"], content: match });
  }
  return {
    matchCount,
    matches: buckets.flat().slice(0, maxMatches).map(({ messageIndex, role, content }) => ({
      messageIndex,
      role,
      rank: content.rank,
      excerpts: buildExcerpts(content.parts),
      occurrenceCount: content.parts.reduce((count, part) => count + part.ranges.length, 0),
    })),
  };
}

export function findMatchRanges(text: string, query: string): { start: number; length: number }[] {
  const needle = query.trim();
  if (needle === "") return [];
  return rangesForPattern(text, new RegExp(escapeRegExp(needle), "giu"));
}

function rangesForPattern(text: string, pattern: RegExp): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const match of text.matchAll(pattern)) {
    ranges.push({ start: match.index, length: match[0].length });
  }
  return ranges;
}

function mergeMatchRanges(ranges: MatchRange[]): MatchRange[] {
  const merged: MatchRange[] = [];
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.start < previous.start + previous.length) previous.length = Math.max(previous.length, range.start + range.length - previous.start);
    else merged.push({ ...range });
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildExcerpts(parts: readonly MatchedText[]): SessionContentSearchExcerpt[] {
  const excerpts: SessionContentSearchExcerpt[] = [];
  let remaining = MAX_EXCERPT_OCCURRENCES;
  for (const part of parts) {
    if (remaining === 0) break;
    const ranges = part.ranges.slice(0, remaining);
    remaining -= ranges.length;
    excerpts.push(...mergeExcerptWindows(part.text, ranges));
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
