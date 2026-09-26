/**
 * Two classes of source Netruimte Radar monitors:
 *
 *   business_signal — company newsrooms, sustainability pages, logistics
 *                     and industrial announcements. Runs through the
 *                     evidence-extraction → scoring → policy pipeline.
 *
 *   grid_update     — regional grid-operator capacity/waiting-list update
 *                     pages (Liander, Enexis, Stedin). Runs through the
 *                     dedicated GridUpdateExtractor. Does NOT feed
 *                     GridContextProvider — that stays municipality-level.
 */
export type SourceClass = 'business_signal' | 'grid_update';

/**
 * Domains whose pages are treated as grid_update sources. Match on the exact
 * host or any subdomain (e.g. `capaciteit.liander.nl` counts as
 * `liander.nl`). Case-insensitive.
 */
export const GRID_UPDATE_DOMAINS: readonly string[] = [
  'liander.nl',
  'enexis.nl',
  'stedin.net',
];

/**
 * Infer a SourceClass from a URL. Defaults to `business_signal` — anything
 * that isn't clearly a Dutch grid-operator page is treated as a business
 * signal, which is the safe default (the business_signal pipeline expects
 * unknown text and will simply reject on "no actionable signal").
 */
export function classifyByUrl(rawUrl: string): SourceClass {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'business_signal';
  }
  for (const domain of GRID_UPDATE_DOMAINS) {
    if (host === domain || host.endsWith('.' + domain)) return 'grid_update';
  }
  return 'business_signal';
}
