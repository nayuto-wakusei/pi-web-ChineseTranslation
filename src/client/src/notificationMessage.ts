import { html } from "lit";

export function renderNotificationMessage(message: string, truncated: boolean) {
  const parts = [];
  let offset = 0;
  // Require a text boundary so embedded schemes such as javascript:https://… stay text.
  for (const match of message.matchAll(/(^|[\s([<'"`])https?:\/\/[^\s<>"'`\p{Cc}]+/giu)) {
    const start = match.index + (match[1] ?? "").length;
    const end = match.index + match[0].length;
    // Even trailing punctuation could be part of a URL cut off by the byte limit.
    if (truncated && end === message.length) continue;
    let url = message.slice(start, end).replace(/[.,!?:;]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
        url = url.slice(0, -1).replace(/[.,!?:;]+$/u, "");
      }
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    } catch {
      // Malformed candidates remain escaped plain text.
      continue;
    }
    parts.push(message.slice(offset, start), html`<a href=${url} target="_blank" rel="noopener noreferrer">${url}</a>`);
    offset = start + url.length;
  }
  parts.push(message.slice(offset));
  return parts;
}
