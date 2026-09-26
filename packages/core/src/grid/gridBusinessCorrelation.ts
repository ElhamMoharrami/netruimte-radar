import type { GridEvent } from '@netruimte/shared';

/**
 * Bonus applied when a business location matches a *recent* grid_update event.
 *
 * This is deliberately additive to the existing GridContextProvider result —
 * the provider still supplies the municipality-level baseline. Grid events are
 * a freshness/context signal only.
 *
 * Safety:
 *   - We never infer grid-neighbour topology from geography alone.
 *   - We never claim a business is directly affected by an event; the
 *     `explanation` says the event MENTIONS the business's location.
 *   - Only exact-name matches count (case-insensitive) — no fuzzy matching.
 *   - Recency window is bounded; older events don't contribute.
 *   - The total bonus is capped so it cannot dominate the existing score.
 */

export interface CorrelationInput {
  company: {
    /** Municipality name as recorded on the company (e.g. "Rotterdam"). */
    city: string | null;
    /** Optional province — supplied by callers that resolved it via PDOK. */
    provincie?: string | null;
  };
  /** Recent grid events (caller may pre-filter; we filter defensively too). */
  gridEvents: GridEvent[];
  /** ISO "now" for reproducible tests. Defaults to Date.now(). */
  now?: string;
  /** Consider events detected within this many days. Default 90. */
  recencyDays?: number;
  /**
   * Per-match points. Kept as options so future tuning doesn't require a code
   * change. Defaults follow the spec:
   *   +10 municipality, +5 region, cap 10.
   */
  municipalityBonus?: number;
  regionBonus?: number;
  totalCap?: number;
}

/** Best geographic evidence found for the correlation. */
export type GeographicMatch = 'municipality' | 'region' | 'none';

export interface CorrelationResult {
  matchedEvents: GridEvent[];
  /**
   * Best geographic evidence class we found:
   *   'municipality' — one or more events name the company's exact city.
   *   'region'       — no municipality match, but events name the province.
   *   'none'         — no match, or no location evidence on the company.
   * Exposed so the UI can render "matched by municipality/region" without
   * re-deriving it from the explanation string.
   */
  geographicMatch: GeographicMatch;
  /** Additive score bonus (0..totalCap). Named `scoreBonus` in the public spec. */
  scoreBonus: number;
  explanation: string;
  confidence: number;
}

export interface GridBusinessCorrelator {
  correlate(input: CorrelationInput): CorrelationResult;
}

export class GridBusinessCorrelationService implements GridBusinessCorrelator {
  correlate(input: CorrelationInput): CorrelationResult {
    const municipalityBonus = input.municipalityBonus ?? 10;
    const regionBonus = input.regionBonus ?? 5;
    const totalCap = input.totalCap ?? 10;
    const recencyDays = input.recencyDays ?? 90;

    const city = normalize(input.company.city);
    const provincie = normalize(input.company.provincie);
    if (!city && !provincie) {
      return {
        matchedEvents: [],
        geographicMatch: 'none',
        scoreBonus: 0,
        explanation: 'no location evidence on company — no correlation attempted',
        confidence: 0,
      };
    }

    const nowMs = input.now ? new Date(input.now).getTime() : Date.now();
    const cutoffMs = nowMs - recencyDays * 86_400_000;
    const recent = input.gridEvents.filter(
      (e) => new Date(e.detectedAt).getTime() >= cutoffMs,
    );

    let rawBonus = 0;
    const matchedEvents: GridEvent[] = [];
    let bestMatchKind: 'municipality' | 'region' | null = null;
    const seenIds = new Set<string>();

    for (const event of recent) {
      const municipalityHit =
        city !== null && event.municipalities.some((m) => normalize(m) === city);
      const regionHit =
        provincie !== null && event.regions.some((r) => normalize(r) === provincie);

      if (municipalityHit) {
        if (!seenIds.has(event.id)) {
          matchedEvents.push(event);
          seenIds.add(event.id);
        }
        rawBonus += municipalityBonus;
        bestMatchKind = 'municipality';
      } else if (regionHit) {
        if (!seenIds.has(event.id)) {
          matchedEvents.push(event);
          seenIds.add(event.id);
        }
        rawBonus += regionBonus;
        if (bestMatchKind !== 'municipality') bestMatchKind = 'region';
      }
    }

    const scoreBonus = Math.min(totalCap, rawBonus);
    const capped = rawBonus > totalCap;
    const geographicMatch: GeographicMatch = bestMatchKind ?? 'none';
    const confidence =
      bestMatchKind === 'municipality'
        ? 0.9
        : bestMatchKind === 'region'
          ? 0.5
          : 0;

    const explanation = buildExplanation({
      matchedCount: matchedEvents.length,
      bestMatchKind,
      city,
      provincie,
      recencyDays,
      capped,
      scoreBonus,
    });

    return { matchedEvents, geographicMatch, scoreBonus, explanation, confidence };
  }
}

function normalize(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length === 0 ? null : t.toLowerCase();
}

function buildExplanation(params: {
  matchedCount: number;
  bestMatchKind: 'municipality' | 'region' | null;
  city: string | null;
  provincie: string | null;
  recencyDays: number;
  capped: boolean;
  scoreBonus: number;
}): string {
  if (params.matchedCount === 0) {
    const loc = [params.city, params.provincie].filter(Boolean).join(' / ') || 'location unknown';
    return `no recent grid_update events mention ${loc} — no correlation bonus`;
  }
  const kind =
    params.bestMatchKind === 'municipality'
      ? `municipality (${params.city ?? '?'})`
      : `region (${params.provincie ?? '?'})`;
  const cap = params.capped ? ' (capped)' : '';
  return `${params.matchedCount} recent grid_update event(s) mention this ${kind} within ${params.recencyDays} days — +${params.scoreBonus}${cap}. Correlation is geographic mention only; it does NOT imply grid-neighbor topology or direct impact.`;
}
