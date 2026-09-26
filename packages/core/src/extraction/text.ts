/**
 * Strip HTML tags, decode a handful of common entities, and collapse
 * whitespace. Good enough for hackathon-grade extraction; we deliberately do
 * not pull in a DOM parser.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:rsquo|lsquo|rdquo|ldquo);/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split into rough sentences (splits on `.`, `!`, `?`). Not linguistically
 * perfect but fine for excerpt-finding.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Find the first sentence containing any of the given keywords. */
export function firstMatchingSentence(
  text: string,
  keywords: RegExp,
): string | null {
  for (const s of sentences(text)) {
    if (keywords.test(s)) return s;
  }
  return null;
}
