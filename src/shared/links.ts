export type TextPart = { type: "text" | "link"; value: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const SENTENCE_PUNCTUATION = /[.,!?;:]$/;

/** Drops punctuation that belongs to the surrounding sentence rather than to the address. */
function trimTrailing(url: string): string {
  let trimmed = url;
  for (;;) {
    if (SENTENCE_PUNCTUATION.test(trimmed)) {
      trimmed = trimmed.slice(0, -1);
    } else if (trimmed.endsWith(")") && trimmed.split(")").length > trimmed.split("(").length) {
      // A closing bracket with no opening one inside the URL closes the sentence's bracket.
      trimmed = trimmed.slice(0, -1);
    } else {
      return trimmed;
    }
  }
}

/**
 * Splits free text into plain runs and web addresses so the addresses can be rendered as
 * links. Only http:// and https:// are recognised; anything else stays text.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_RE)) {
    const url = trimTrailing(match[0]);
    // Just the scheme with nothing after it is not a link.
    if (!/^https?:\/\/[^/.]/.test(url)) continue;

    if (match.index > cursor) parts.push({ type: "text", value: text.slice(cursor, match.index) });
    parts.push({ type: "link", value: url });
    cursor = match.index + url.length;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}
