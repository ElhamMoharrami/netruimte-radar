import { createHash } from 'node:crypto';

/**
 * Business-source dedupe helpers.
 *
 * Two independent normalizations feed a single `(canonicalUrl, contentHash)`
 * key. Kept deliberately minimal — heavy normalization risks collapsing two
 * *genuinely different* URLs (e.g. `?page=2`) into the same key, which would
 * violate spec rule 6 ("Do not deduplicate two genuinely different URLs
 * merely because they discuss the same company").
 *
 * Both helpers are pure and deterministic so the same crawl in two different
 * scans produces the same key.
 */

/**
 * Canonicalize a source URL for dedupe. The goal is to collapse only
 * *cosmetically* different renderings of the same page, not semantic ones:
 *
 *   - scheme + host lowercased (`HTTPS://Example.com/x` == `https://example.com/x`)
 *   - default ports stripped (`:80` on http, `:443` on https)
 *   - trailing `/` dropped on non-root paths
 *   - URL fragment (`#anchor`) dropped — same document
 *   - query string preserved verbatim so `?page=2` stays distinct from `?page=3`
 *
 * On invalid URLs we return the trimmed original so the caller still gets
 * something stable to compare on (won't match a valid URL by accident).
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const scheme = u.protocol.toLowerCase();
    const host = u.hostname.toLowerCase();
    const port =
      (scheme === 'http:' && u.port === '80') || (scheme === 'https:' && u.port === '443')
        ? ''
        : u.port
          ? ':' + u.port
          : '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return `${scheme}//${host}${port}${path}${u.search}`;
  } catch {
    return rawUrl.trim();
  }
}

/**
 * SHA-256 over the raw text after collapsing whitespace runs. Whitespace
 * collapsing means that if the crawler re-emits the same page with slightly
 * different indentation / trailing-newline behaviour the hash still matches.
 * Anything more aggressive (case folding, stopword stripping) risks masking
 * real edits, so we stop here.
 */
export function computeBusinessSourceContentHash(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
