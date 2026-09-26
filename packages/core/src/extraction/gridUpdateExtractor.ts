import { createHash } from 'node:crypto';
import { firstMatchingSentence, sentences, stripHtml } from './text.js';
import type { DiscoveredSource } from '../sources/types.js';

/**
 * ─── Grid-update extraction ─────────────────────────────────────────────────
 *
 * Extracts one or more structured grid-capacity events from public Dutch
 * grid-operator update pages (Liander, Enexis, Stedin).
 *
 * Never invents:
 *   - MW values (we do not emit numeric capacity fields at all)
 *   - municipalities (only names that literally appear in text and match our
 *     Dutch-municipalities lexicon are added; province-only pages return
 *     `municipalities: []`)
 *   - stations (only names anchored by an operator noun — "onderstation",
 *     "verdeelstation", "hoogspanningsstation", "OS", "TenneT-station" —
 *     are extracted)
 *   - direction (returns `"unknown"` unless the page literally mentions
 *     afname/verbruik or teruglever/invoeding/opwek)
 *
 * If a page discusses multiple independent events (typical for capacity
 * bulletins with H2 sections), one `GridUpdateExtraction` is emitted per
 * section. Pages that only support a regional claim return the region only.
 *
 * This extractor is dedicated. It NEVER touches the business EvidenceExtractor
 * pipeline, and it NEVER writes into GridContextProvider — that provider
 * stays municipality-level and is fed by the Netbeheer NL snapshot.
 */

export type GridOperator = 'liander' | 'enexis' | 'stedin' | 'unknown';

export type GridEventType =
  | 'new_bottleneck'
  | 'capacity_update'
  | 'congestion_study_completed'
  | 'waiting_list_update'
  | 'capacity_released'
  | 'other';

export type GridDirection = 'consumption' | 'feed_in' | 'both' | 'unknown';

export interface GridUpdateExtraction {
  operator: GridOperator;
  eventType: GridEventType;
  regions: string[];
  municipalities: string[];
  stations: string[];
  direction: GridDirection;
  summary: string;
  evidenceExcerpt: string;
  confidence: number;
  publishedAt: string | null;
  sourceUrl: string;
  /** Which extractor produced this record — for audit only. */
  extractor: string;
}

export interface GridUpdateExtractorInput {
  source: DiscoveredSource;
}

export interface GridUpdateExtractor {
  readonly name: string;
  extract(input: GridUpdateExtractorInput): Promise<GridUpdateExtraction[]>;
}

/**
 * Rule-based, deterministic implementation. Preferred first extractor per the
 * spec — an AI extractor can be layered on via `FallbackGridUpdateExtractor`.
 */
export class RuleBasedGridUpdateExtractor implements GridUpdateExtractor {
  readonly name = 'rule-based-grid';

  async extract(input: GridUpdateExtractorInput): Promise<GridUpdateExtraction[]> {
    const { source } = input;
    const operator = detectOperatorFromUrl(source.url);
    // Split on markdown-style headings BEFORE stripping HTML — stripHtml
    // collapses newlines, which would erase the `^#` heading boundaries.
    const rawSections = splitIntoEvents(source.rawText);
    const sections = rawSections.map((s) => stripHtml(s)).filter((s) => s.length > 0);
    const cleanText = stripHtml(source.rawText);

    const events: GridUpdateExtraction[] = [];
    for (const section of sections) {
      const eventType = detectEventType(section);
      const direction = detectDirection(section);
      const regions = detectRegions(section);
      const municipalities = detectMunicipalities(section);
      const stations = detectStations(section);
      // Skip empty sections that contribute no signal at all.
      if (
        eventType === 'other' &&
        direction === 'unknown' &&
        regions.length === 0 &&
        municipalities.length === 0 &&
        stations.length === 0
      ) {
        continue;
      }
      const evidenceExcerpt =
        firstMatchingSentence(
          section,
          /(afname|teruglever|invoeding|congest|capacit|wachtlijst|transport|bottleneck)/i,
        ) ?? section.slice(0, 240);

      const confidence = computeConfidence({
        operatorKnown: operator !== 'unknown',
        eventType,
        direction,
        regionCount: regions.length,
        municipalityCount: municipalities.length,
        stationCount: stations.length,
        hasPublishedAt: Boolean(source.publishedAt),
      });

      events.push({
        operator,
        eventType,
        regions,
        municipalities,
        stations,
        direction,
        summary: buildSummary({ operator, eventType, regions, municipalities, stations }),
        evidenceExcerpt: evidenceExcerpt.slice(0, 400),
        confidence,
        publishedAt: source.publishedAt ?? null,
        sourceUrl: source.url,
        extractor: this.name,
      });
    }

    // If splitting produced zero useful events, emit a single "other" record so
    // the operator sees the page was picked up. Requirement 5 ("if the page is
    // broad and only supports a regional claim, return the region only") is
    // satisfied by this fallback because `regions` may still be non-empty.
    if (events.length === 0) {
      const regions = detectRegions(cleanText);
      const municipalities = detectMunicipalities(cleanText);
      const stations = detectStations(cleanText);
      const direction = detectDirection(cleanText);
      const confidence = computeConfidence({
        operatorKnown: operator !== 'unknown',
        eventType: 'other',
        direction,
        regionCount: regions.length,
        municipalityCount: municipalities.length,
        stationCount: stations.length,
        hasPublishedAt: Boolean(source.publishedAt),
      });
      events.push({
        operator,
        eventType: 'other',
        regions,
        municipalities,
        stations,
        direction,
        summary: buildSummary({ operator, eventType: 'other', regions, municipalities, stations }),
        evidenceExcerpt: (cleanText.slice(0, 240) || '').trim(),
        confidence,
        publishedAt: source.publishedAt ?? null,
        sourceUrl: source.url,
        extractor: this.name,
      });
    }

    return events;
  }
}

// ---------------------------------------------------------------------------
// Public helpers (exported for tests + potential AI-fallback prompt building)
// ---------------------------------------------------------------------------

export function detectOperatorFromUrl(rawUrl: string): GridOperator {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (host === 'liander.nl' || host.endsWith('.liander.nl')) return 'liander';
  if (host === 'enexis.nl' || host.endsWith('.enexis.nl')) return 'enexis';
  if (host === 'stedin.net' || host.endsWith('.stedin.net')) return 'stedin';
  return 'unknown';
}

export function detectEventType(text: string): GridEventType {
  // Order matters — more specific patterns first. Patterns are deliberately
  // lenient (`[^.\n]{0,N}` between key words) because operator pages often
  // insert region/direction phrases between "congestieonderzoek" and
  // "afgerond", "capaciteit" and "beschikbaar", etc.
  const patterns: Array<[RegExp, GridEventType]> = [
    [
      /(congestieonderzoek[^.\n]{0,80}afgerond|congestion(?:[-\s]management)?\s+study[^.\n]{0,60}(?:completed|afgerond))/i,
      'congestion_study_completed',
    ],
    [
      /((?:extra|nieuwe?)\s+capaciteit[^.\n]{0,40}beschikbaar|capaciteit\s+vrijgegeven|released\s+capacity|new\s+capacity\s+released)/i,
      'capacity_released',
    ],
    [
      /(nieuw\s+knelpunt|nieuwe\s+congestie|opgenomen\s+op\s+de\s+wachtlijst|aangewezen\s+als\s+congestiegebied|new\s+bottleneck)/i,
      'new_bottleneck',
    ],
    [
      /(wachtlijst[^.\n]{0,40}(?:update|verkort|verlengd|aangepast|bijgewerkt|geplaatst)|update(?:\s+van)?\s+de\s+wachtlijst|waiting[-\s]list\s+update)/i,
      'waiting_list_update',
    ],
    [
      /(capaciteit(?:skaart)?[^.\n]{0,20}bijgewerkt|update\s+capaciteit|nieuwe\s+status\s+capaciteit|capacity\s+update)/i,
      'capacity_update',
    ],
  ];
  for (const [re, type] of patterns) {
    if (re.test(text)) return type;
  }
  return 'other';
}

export function detectDirection(text: string): GridDirection {
  const consumption = /(afname|verbruik|wachtlijst\s+(?:voor\s+)?afname|consumption)/i.test(text);
  const feedIn = /(teruglever(?:ing)?|invoeding|opwek|feed[-\s]?in)/i.test(text);
  if (consumption && feedIn) return 'both';
  if (consumption) return 'consumption';
  if (feedIn) return 'feed_in';
  return 'unknown';
}

/**
 * The 12 Dutch provinces plus a small number of frequently-cited operator
 * regions. Anything not in this list is NOT treated as a region.
 */
const DUTCH_REGIONS: readonly string[] = [
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
  'Randstad',
  'Brainport',
  'Eemsdelta',
];

/**
 * Municipalities that are NOT one of the 12 province names. Deliberately
 * disjoint from `DUTCH_REGIONS` so a hit is unambiguous: if we detect
 * "Amsterdam" it goes to municipalities; if we detect "Utrecht" it goes to
 * regions (Utrecht is both a province and a city — we default to region to
 * avoid inventing a municipality claim).
 */
const DUTCH_MUNICIPALITIES: readonly string[] = [
  'Amsterdam',
  'Rotterdam',
  'Den Haag',
  "'s-Gravenhage",
  'Eindhoven',
  'Tilburg',
  'Almere',
  'Breda',
  'Nijmegen',
  'Enschede',
  'Haarlem',
  'Arnhem',
  'Amersfoort',
  'Zaanstad',
  "'s-Hertogenbosch",
  'Zwolle',
  'Leiden',
  'Maastricht',
  'Delft',
  'Dordrecht',
  'Alkmaar',
  'Apeldoorn',
  'Ede',
  'Helmond',
  'Sittard',
  'Venlo',
  'Middelburg',
  'Assen',
  'Emmen',
  'Leeuwarden',
  'Lelystad',
  'Zeewolde',
  'Nieuwegein',
  'Hollands Kroon',
  'Krommenie',
  'Deventer',
  'Hengelo',
];

export function detectRegions(text: string): string[] {
  return matchLexicon(text, DUTCH_REGIONS);
}

export function detectMunicipalities(text: string): string[] {
  return matchLexicon(text, DUTCH_MUNICIPALITIES);
}

/**
 * A station name is only accepted when preceded by an operator noun. This
 * avoids inventing station names from arbitrary capitalized words.
 *   - "onderstation X"
 *   - "verdeelstation X"
 *   - "hoogspanningsstation X"
 *   - "transformatorstation X"
 *   - "TenneT-station X"
 *   - "OS X" (Dutch operator shorthand for onderstation)
 * The name may be two capitalized tokens ("Bergen op Zoom" style).
 */
export function detectStations(text: string): string[] {
  const hits = new Set<string>();
  const re =
    // Case-insensitive on the anchor word only; the name must start with a
    // real capital letter — hence per-letter alternation instead of the `/i`
    // flag (which would also lower-case the [A-Z] in the name group).
    // Allows Dutch connectives like "op", "aan", "de", "van" between capitalised
    // tokens ("Bergen op Zoom") but only if they're followed by another capital.
    /(?:[Oo]nderstation|[Vv]erdeelstation|[Hh]oogspanningsstation|[Tt]ransformatorstation|TenneT[-\s]station|\bOS)\s+([A-Z][a-zà-ÿ'’-]+(?:\s+(?:[a-z]{2,4}\s+)?[A-Z][a-zà-ÿ'’-]+){0,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1]?.trim();
    if (name) hits.add(name);
  }
  return [...hits].sort();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function matchLexicon(text: string, lexicon: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const term of lexicon) {
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
    if (re.test(text)) hits.add(term);
  }
  return [...hits].sort();
}

/**
 * Split a page into candidate events. If the page uses markdown-style
 * headings (# / ## / ###) with at least two headings, treat each heading and
 * its body as its own event. Otherwise return the whole document as a single
 * event.
 *
 * Conservative on purpose — over-splitting would generate spurious "other"
 * events, and requirement 4 says never invent structure.
 */
function splitIntoEvents(text: string): string[] {
  const headingRe = /^\s*#{1,3}\s+.+$/gm;
  const headings = text.match(headingRe) ?? [];
  if (headings.length < 2) return [text];
  const parts = text
    .split(/(?=^\s*#{1,3}\s+)/m)
    .map((p) => p.trim())
    .filter((p) => p.length >= 40);
  return parts.length >= 2 ? parts : [text];
}

function computeConfidence(inputs: {
  operatorKnown: boolean;
  eventType: GridEventType;
  direction: GridDirection;
  regionCount: number;
  municipalityCount: number;
  stationCount: number;
  hasPublishedAt: boolean;
}): number {
  let c = 0.3;
  if (inputs.operatorKnown) c += 0.2;
  if (inputs.eventType !== 'other') c += 0.15;
  if (inputs.direction !== 'unknown') c += 0.15;
  if (inputs.regionCount + inputs.municipalityCount > 0) c += 0.1;
  if (inputs.stationCount > 0) c += 0.05;
  if (inputs.hasPublishedAt) c += 0.05;
  return Math.min(1, Math.max(0, Number(c.toFixed(2))));
}

function buildSummary(params: {
  operator: GridOperator;
  eventType: GridEventType;
  regions: string[];
  municipalities: string[];
  stations: string[];
}): string {
  const op = params.operator === 'unknown' ? 'Unknown operator' : capitalize(params.operator);
  const evt = params.eventType.replace(/_/g, ' ');
  const where: string[] = [];
  if (params.stations.length > 0) where.push(`stations ${params.stations.slice(0, 3).join(', ')}`);
  if (params.municipalities.length > 0)
    where.push(`in ${params.municipalities.slice(0, 3).join(', ')}`);
  else if (params.regions.length > 0) where.push(`in ${params.regions.slice(0, 3).join(', ')}`);
  const whereStr = where.length > 0 ? ' — ' + where.join(', ') : '';
  return `${op}: ${evt}${whereStr}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Silence unused-import warning when tests remove `sentences` reference; keeps
// the shared text.ts surface aligned with the business extractor.
void sentences;

/**
 * Stable content-hash for dedup. Same (operator, eventType, regions,
 * municipalities, stations, direction) → same hash, regardless of surface
 * text like `summary` / `evidenceExcerpt` (which the extractor rewrites) or
 * `publishedAt` / `detectedAt` (which change over time). Sorted arrays so
 * order doesn't leak into the hash.
 *
 * A GridEvent is considered "the same" if its (sourceUrl, contentHash) pair
 * has already been persisted — see AutonomousRunService.processGridUpdateSource.
 */
export function computeGridEventContentHash(input: {
  operator: GridOperator;
  eventType: GridEventType;
  regions: readonly string[];
  municipalities: readonly string[];
  stations: readonly string[];
  direction: GridDirection;
}): string {
  const canonical = JSON.stringify({
    operator: input.operator,
    eventType: input.eventType,
    regions: [...input.regions].sort(),
    municipalities: [...input.municipalities].sort(),
    stations: [...input.stations].sort(),
    direction: input.direction,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
