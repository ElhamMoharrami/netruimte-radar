import type { CongestionContext, CongestionLevel } from '@netruimte/shared';
import type { GridContextProvider, GridQuery } from './types.js';

/**
 * Static demo map from Dutch city name → congestion level. Loosely based on
 * TenneT/Netbeheer Nederland's public "capaciteitskaart" — but this is not a
 * live data source, and we NEVER claim otherwise. See
 * https://capaciteitskaart.netbeheernederland.nl
 *
 * Any user of this data must inspect `source` and `checkedAt` before acting.
 */
const CITY_TABLE: Record<string, { level: CongestionLevel; notes: string }> = {
  Rotterdam: {
    level: 'severe',
    notes: 'Demo dataset: port area has widely reported afname/teruglever constraints.',
  },
  Zwolle: {
    level: 'high',
    notes: 'Demo dataset: Overijssel afname congestion reported at regional level.',
  },
  Utrecht: {
    level: 'moderate',
    notes: 'Demo dataset: mixed reports; treat as moderate for demo purposes.',
  },
  Amsterdam: { level: 'high', notes: 'Demo dataset: Amsterdam area teruglever constraints.' },
  'Den Haag': { level: 'moderate', notes: 'Demo dataset.' },
  Eindhoven: { level: 'high', notes: 'Demo dataset: Brainport growth vs capaciteit.' },
  Groningen: { level: 'severe', notes: 'Demo dataset: Groningen region well-known constraints.' },
  Almere: { level: 'moderate', notes: 'Demo dataset.' },
  Nijmegen: { level: 'moderate', notes: 'Demo dataset.' },
  Arnhem: { level: 'moderate', notes: 'Demo dataset.' },
};

export class DemoGridContextProvider implements GridContextProvider {
  readonly name = 'demo';

  async getGridContext(query: GridQuery): Promise<CongestionContext> {
    const city = normalizeCity(query.city);
    const hit = city ? CITY_TABLE[city] : undefined;
    const now = new Date().toISOString();
    if (!hit) {
      return {
        level: 'unknown',
        source: 'DemoGridContextProvider',
        sourceUrl: null,
        checkedAt: now,
        notes: `No demo entry for city="${query.city ?? '?'}"`,
      };
    }
    return {
      level: hit.level,
      source: 'DemoGridContextProvider',
      sourceUrl: 'https://capaciteitskaart.netbeheernederland.nl',
      checkedAt: now,
      notes: hit.notes,
    };
  }
}

function normalizeCity(city: string | undefined): string | undefined {
  if (!city) return undefined;
  const trimmed = city.trim();
  // Simple case-insensitive lookup — table keys are canonical.
  for (const key of Object.keys(CITY_TABLE)) {
    if (key.toLowerCase() === trimmed.toLowerCase()) return key;
  }
  return undefined;
}
