import { describe, expect, it } from 'vitest';
import {
  FallbackGridUpdateExtractor,
  RuleBasedGridUpdateExtractor,
  detectDirection,
  detectEventType,
  detectMunicipalities,
  detectOperatorFromUrl,
  detectRegions,
  detectStations,
} from './index.js';
import type { DiscoveredSource } from '../sources/types.js';
import type {
  GridUpdateExtraction,
  GridUpdateExtractor,
  GridUpdateExtractorInput,
} from './gridUpdateExtractor.js';

function src(
  url: string,
  rawText: string,
  publishedAt: string | null = null,
  title = 'Grid update',
): DiscoveredSource {
  return {
    url,
    title,
    rawText,
    discoveredAt: new Date().toISOString(),
    publishedAt,
    sourceClass: 'grid_update',
    provider: 'test',
  };
}

// ─── Fixtures modeled after real crawler output ───────────────────────────
//
// These are written to match what `apify/website-content-crawler` would emit
// for each operator page: a short title + a paragraph or three of body text.
// The text intentionally mixes Dutch and English phrasings we've seen on
// live pages.

const LIANDER_MULTI_SECTION = `# Update capaciteitskaart 2026-02

## Noord-Holland — nieuw knelpunt in Amsterdam
Voor afname is er een nieuw knelpunt in Amsterdam. Klanten worden opgenomen op de wachtlijst.
Ook onderstation Krommenie is beperkt.

## Flevoland — extra capaciteit beschikbaar
In Flevoland is extra capaciteit beschikbaar voor teruglevering.
`;

const ENEXIS_STUDY = `Congestieonderzoek Groningen afgerond

Enexis heeft het congestieonderzoek voor de provincie Groningen afgerond.
Zowel afname als teruglevering worden nu meegenomen in het capaciteitsbeeld.
Verdeelstation Delfzijl valt binnen het onderzoeksgebied.
`;

const STEDIN_WAITINGLIST = `Update van de wachtlijst voor afname — Zuid-Holland

De wachtlijst voor afname is bijgewerkt. Nieuwe aanmeldingen in Rotterdam en Dordrecht worden op de wachtlijst geplaatst.
`;

const BROAD_REGIONAL_ONLY = `Nieuwe capaciteit is beschikbaar in de Randstad. Vraag naar transport blijft hoog.`;

const NO_SIGNAL = `Onze klantendienst is bereikbaar op werkdagen van 9 tot 17 uur. Voor storingen bel 0800.`;

async function extract(source: DiscoveredSource): Promise<GridUpdateExtraction[]> {
  return new RuleBasedGridUpdateExtractor().extract({ source });
}

// ─── Unit tests for the small detectors ────────────────────────────────────

describe('detectOperatorFromUrl (lowercase enum)', () => {
  it('resolves the three grid-operator hosts + subdomains', () => {
    expect(detectOperatorFromUrl('https://www.liander.nl/x')).toBe('liander');
    expect(detectOperatorFromUrl('https://capaciteit.liander.nl/y')).toBe('liander');
    expect(detectOperatorFromUrl('https://www.enexis.nl/x')).toBe('enexis');
    expect(detectOperatorFromUrl('https://transportkaart.enexis.nl/y')).toBe('enexis');
    expect(detectOperatorFromUrl('https://www.stedin.net/x')).toBe('stedin');
  });
  it('returns unknown for non-grid hosts and malformed input', () => {
    expect(detectOperatorFromUrl('https://newsroom.postnl.nl/x')).toBe('unknown');
    expect(detectOperatorFromUrl('nonsense')).toBe('unknown');
  });
});

describe('detectEventType', () => {
  it('congestieonderzoek afgerond → congestion_study_completed', () => {
    expect(detectEventType('Enexis heeft het congestieonderzoek afgerond.')).toBe(
      'congestion_study_completed',
    );
  });
  it('extra capaciteit beschikbaar → capacity_released', () => {
    expect(detectEventType('In Flevoland is extra capaciteit beschikbaar.')).toBe(
      'capacity_released',
    );
  });
  it('nieuw knelpunt / opgenomen op de wachtlijst → new_bottleneck', () => {
    expect(detectEventType('Er is een nieuw knelpunt in Amsterdam.')).toBe('new_bottleneck');
    expect(detectEventType('Klanten worden opgenomen op de wachtlijst.')).toBe('new_bottleneck');
  });
  it('update van de wachtlijst → waiting_list_update', () => {
    expect(detectEventType('De wachtlijst is bijgewerkt.')).toBe('waiting_list_update');
    expect(detectEventType('Update van de wachtlijst voor Zuid-Holland.')).toBe(
      'waiting_list_update',
    );
  });
  it('capaciteitskaart bijgewerkt → capacity_update', () => {
    expect(detectEventType('De capaciteitskaart is bijgewerkt op 2026-02.')).toBe('capacity_update');
  });
  it('unrelated text → other', () => {
    expect(detectEventType('Onze klantendienst is bereikbaar op werkdagen.')).toBe('other');
  });
});

describe('detectDirection', () => {
  it('afname only → consumption', () => {
    expect(detectDirection('Wachtlijst voor afname in Utrecht.')).toBe('consumption');
  });
  it('teruglevering only → feed_in', () => {
    expect(detectDirection('Nieuwe teruglevercapaciteit vrijgegeven.')).toBe('feed_in');
  });
  it('both mentioned → both', () => {
    expect(detectDirection('Zowel afname als teruglevering worden meegenomen.')).toBe('both');
  });
  it('no direction wording → unknown', () => {
    expect(detectDirection('De klantendienst is gesloten.')).toBe('unknown');
  });
});

describe('detectRegions vs detectMunicipalities (never invents)', () => {
  it('provinces + operator regions land in regions[], never in municipalities[]', () => {
    const t = 'Beperkingen in Groningen, Flevoland en de Randstad.';
    expect(detectRegions(t)).toEqual(['Flevoland', 'Groningen', 'Randstad']);
    expect(detectMunicipalities(t)).toEqual([]);
  });
  it('cities land in municipalities[] only', () => {
    const t = 'Nieuwe aanmeldingen in Amsterdam en Rotterdam.';
    expect(detectMunicipalities(t)).toEqual(['Amsterdam', 'Rotterdam']);
    expect(detectRegions(t)).toEqual([]);
  });
  it('Utrecht defaults to region (safer than inventing a municipality claim)', () => {
    const t = 'Update voor Utrecht en Amsterdam.';
    expect(detectRegions(t)).toEqual(['Utrecht']);
    expect(detectMunicipalities(t)).toEqual(['Amsterdam']);
  });
  it('random capitalised words are NOT invented as municipalities', () => {
    const t = 'Beste Bezoeker, dit is Voor Iedereen bereikbaar.';
    expect(detectMunicipalities(t)).toEqual([]);
  });
});

describe('detectStations (never invents)', () => {
  it('reads names anchored by an operator noun', () => {
    expect(
      detectStations('Onderstation Krommenie en verdeelstation Delfzijl vallen in het gebied.'),
    ).toEqual(['Delfzijl', 'Krommenie']);
    expect(detectStations('OS Bergen op Zoom is bijgewerkt.')).toEqual(['Bergen op Zoom']);
  });
  it('does NOT extract capitalised words that are not anchored by an operator noun', () => {
    expect(detectStations('Krommenie is een dorp in Noord-Holland.')).toEqual([]);
  });
});

// ─── End-to-end fixture tests per operator ────────────────────────────────

describe('RuleBasedGridUpdateExtractor — Liander multi-section fixture', () => {
  it('splits the doc into ≥ 2 events; each carries region/municipality/direction/eventType', async () => {
    const events = await extract(
      src(
        'https://www.liander.nl/nieuws/capaciteitskaart-2026-02',
        LIANDER_MULTI_SECTION,
        '2026-02-10T10:00:00.000Z',
      ),
    );

    expect(events.length).toBeGreaterThanOrEqual(2);

    for (const e of events) {
      expect(e.operator).toBe('liander');
      expect(e.sourceUrl).toBe('https://www.liander.nl/nieuws/capaciteitskaart-2026-02');
      expect(e.publishedAt).toBe('2026-02-10T10:00:00.000Z');
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
      expect(e.evidenceExcerpt.length).toBeGreaterThan(0);
    }

    const bottleneck = events.find((e) => e.eventType === 'new_bottleneck');
    expect(bottleneck).toBeDefined();
    expect(bottleneck!.direction).toBe('consumption');
    expect(bottleneck!.regions).toContain('Noord-Holland');
    expect(bottleneck!.municipalities).toContain('Amsterdam');
    expect(bottleneck!.stations).toContain('Krommenie');

    const released = events.find((e) => e.eventType === 'capacity_released');
    expect(released).toBeDefined();
    expect(released!.direction).toBe('feed_in');
    expect(released!.regions).toContain('Flevoland');
    expect(released!.municipalities).toEqual([]);
    expect(released!.stations).toEqual([]);
  });
});

describe('RuleBasedGridUpdateExtractor — Enexis congestion-study fixture', () => {
  it('detects congestion_study_completed, both directions, region + station', async () => {
    const events = await extract(
      src(
        'https://www.enexis.nl/nieuws/congestieonderzoek-groningen',
        ENEXIS_STUDY,
        '2026-01-08T09:00:00.000Z',
      ),
    );
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.operator).toBe('enexis');
    expect(e.eventType).toBe('congestion_study_completed');
    expect(e.direction).toBe('both');
    expect(e.regions).toContain('Groningen');
    expect(e.municipalities).toEqual([]);
    expect(e.stations).toContain('Delfzijl');
    expect(e.publishedAt).toBe('2026-01-08T09:00:00.000Z');
    expect(e.confidence).toBeGreaterThanOrEqual(0.7);
    expect(e.summary.toLowerCase()).toContain('enexis');
    expect(e.summary).toContain('congestion study completed');
  });
});

describe('RuleBasedGridUpdateExtractor — Stedin waiting-list fixture', () => {
  it('detects waiting_list_update, consumption, region + cities', async () => {
    const events = await extract(
      src('https://www.stedin.net/zakelijk/wachtlijst/zuid-holland', STEDIN_WAITINGLIST, null),
    );
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.operator).toBe('stedin');
    expect(e.eventType).toBe('waiting_list_update');
    expect(e.direction).toBe('consumption');
    expect(e.regions).toContain('Zuid-Holland');
    expect(e.municipalities).toEqual(expect.arrayContaining(['Rotterdam', 'Dordrecht']));
    expect(e.stations).toEqual([]);
    expect(e.publishedAt).toBeNull();
  });
});

describe('RuleBasedGridUpdateExtractor — anti-invention guarantees', () => {
  it('broad regional-only page: returns the region only, empty municipalities/stations', async () => {
    const events = await extract(src('https://www.liander.nl/x', BROAD_REGIONAL_ONLY));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.regions).toEqual(['Randstad']);
    expect(e.municipalities).toEqual([]);
    expect(e.stations).toEqual([]);
    expect(e.eventType).toBe('capacity_released');
  });

  it('page with no signal at all: still returns 1 event with everything empty and eventType=other', async () => {
    const events = await extract(src('https://www.liander.nl/klantendienst', NO_SIGNAL));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.eventType).toBe('other');
    expect(e.direction).toBe('unknown');
    expect(e.regions).toEqual([]);
    expect(e.municipalities).toEqual([]);
    expect(e.stations).toEqual([]);
    expect(e.confidence).toBeGreaterThan(0);
  });

  it('summary never contains MW/kV/MVA numbers we did not see in text', async () => {
    const events = await extract(src('https://www.liander.nl/x', LIANDER_MULTI_SECTION));
    for (const e of events) {
      expect(e.summary).not.toMatch(/\d+\s*(MW|kV|MVA)/i);
    }
  });

  it('unknown operator: URL not on the grid list → operator=unknown, still emits an event', async () => {
    const events = await extract(
      src('https://example.com/random', 'Nieuwe capaciteit beschikbaar in Groningen.'),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.operator).toBe('unknown');
    expect(events[0]!.regions).toContain('Groningen');
  });
});

describe('FallbackGridUpdateExtractor — secondary is used when primary throws', () => {
  class Throwing implements GridUpdateExtractor {
    readonly name = 'primary:throwing';
    async extract(): Promise<GridUpdateExtraction[]> {
      throw new Error('boom');
    }
  }

  it('routes to the secondary and stamps the extractor name for audit', async () => {
    const wrapped = new FallbackGridUpdateExtractor(
      new Throwing(),
      new RuleBasedGridUpdateExtractor(),
    );
    const events = await wrapped.extract({
      source: src('https://www.stedin.net/x', STEDIN_WAITINGLIST),
    } as GridUpdateExtractorInput);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.extractor).toContain('rule-based-grid');
      expect(e.extractor).toContain('primary:throwing failed');
    }
  });

  it('when primary succeeds, secondary is not called', async () => {
    let secondaryCalls = 0;
    const secondary: GridUpdateExtractor = {
      name: 'secondary:should-not-fire',
      async extract() {
        secondaryCalls += 1;
        return [];
      },
    };
    const wrapped = new FallbackGridUpdateExtractor(new RuleBasedGridUpdateExtractor(), secondary);
    const events = await wrapped.extract({
      source: src('https://www.stedin.net/x', STEDIN_WAITINGLIST),
    } as GridUpdateExtractorInput);
    expect(events.length).toBeGreaterThan(0);
    expect(secondaryCalls).toBe(0);
  });
});
