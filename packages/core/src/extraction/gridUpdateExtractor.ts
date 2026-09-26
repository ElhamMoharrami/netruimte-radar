import { stripHtml, firstMatchingSentence } from './text.js';
import type { DiscoveredSource } from '../sources/types.js';

/**
 * Output of the grid_update pipeline. Deliberately separate from
 * `ExtractionResult` (which is business-signal shaped): grid update pages
 * describe operator capacity announcements, not company-level events.
 *
 * This does NOT feed into GridContextProvider — that provider stays
 * municipality-level and is fed by the Netbeheer NL snapshot. Grid updates
 * are audited via the activity log so operators can see what the crawler
 * picked up from Liander/Enexis/Stedin.
 */
export interface GridUpdateExtraction {
  operator: GridOperator;
  updateType: 'consumption' | 'feed_in' | 'both' | 'unknown';
  summary: string;
  evidenceExcerpt: string;
  mentionedRegions: string[];
  sourceUrl: string;
  publishedAt: string | null;
  extractor: string;
}

export type GridOperator = 'Liander' | 'Enexis' | 'Stedin' | 'Unknown';

export interface GridUpdateExtractorInput {
  source: DiscoveredSource;
}

export interface GridUpdateExtractor {
  readonly name: string;
  extract(input: GridUpdateExtractorInput): Promise<GridUpdateExtraction>;
}

/** Cheap, deterministic rule-based extractor for grid_update pages. */
export class RuleBasedGridUpdateExtractor implements GridUpdateExtractor {
  readonly name = 'rule-based-grid';

  async extract(input: GridUpdateExtractorInput): Promise<GridUpdateExtraction> {
    const { source } = input;
    const text = stripHtml(source.rawText);

    const operator = detectOperatorFromUrl(source.url);
    const updateType = detectUpdateType(text);
    const mentionedRegions = detectRegions(text);
    const evidenceExcerpt =
      firstMatchingSentence(text, /(afname|teruglever|invoeding|congestie|capaciteit|wachtlijst|transport)/i) ??
      text.slice(0, 240);

    const summary = buildSummary({ operator, updateType, mentionedRegions });

    return {
      operator,
      updateType,
      summary,
      evidenceExcerpt: evidenceExcerpt.slice(0, 400),
      mentionedRegions,
      sourceUrl: source.url,
      publishedAt: source.publishedAt,
      extractor: this.name,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function detectOperatorFromUrl(rawUrl: string): GridOperator {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'Unknown';
  }
  if (host === 'liander.nl' || host.endsWith('.liander.nl')) return 'Liander';
  if (host === 'enexis.nl' || host.endsWith('.enexis.nl')) return 'Enexis';
  if (host === 'stedin.net' || host.endsWith('.stedin.net')) return 'Stedin';
  return 'Unknown';
}

export function detectUpdateType(text: string): GridUpdateExtraction['updateType'] {
  const consumption = /(afname|verbruik|consumption|wachtlijst\s+voor\s+afname)/i.test(text);
  const feedIn = /(teruglever|invoeding|feed[-\s]?in|opwek|teruglevering)/i.test(text);
  if (consumption && feedIn) return 'both';
  if (consumption) return 'consumption';
  if (feedIn) return 'feed_in';
  return 'unknown';
}

const DUTCH_REGIONS = [
  // Provinces
  'Groningen',
  'Friesland',
  'Drenthe',
  'Overijssel',
  'Flevoland',
  'Gelderland',
  'Utrecht',
  'Noord-Holland',
  'Zuid-Holland',
  'Zeeland',
  'Noord-Brabant',
  'Limburg',
  // Frequently-cited operator regions
  'Amsterdam',
  'Rotterdam',
  'Den Haag',
  'Utrechtse Heuvelrug',
  'Brainport',
  'Randstad',
  'Eemsdelta',
  'Hessenpoort',
];

export function detectRegions(text: string): string[] {
  const hits = new Set<string>();
  for (const region of DUTCH_REGIONS) {
    // Word-boundary match; region names may contain hyphens which \b handles.
    const re = new RegExp(`\\b${escapeRegex(region)}\\b`, 'i');
    if (re.test(text)) hits.add(region);
  }
  return [...hits].sort();
}

function buildSummary(params: {
  operator: GridOperator;
  updateType: GridUpdateExtraction['updateType'];
  mentionedRegions: string[];
}): string {
  const typeStr =
    params.updateType === 'consumption'
      ? 'consumption capacity'
      : params.updateType === 'feed_in'
        ? 'feed-in capacity'
        : params.updateType === 'both'
          ? 'consumption + feed-in capacity'
          : 'grid capacity';
  const region =
    params.mentionedRegions.length > 0
      ? ` mentioning ${params.mentionedRegions.slice(0, 3).join(', ')}`
      : '';
  return `${params.operator} update on ${typeStr}${region}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
