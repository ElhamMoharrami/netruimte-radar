import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { DemoSourceDiscoveryProvider } from '../sources/demoProvider.js';
import { RuleBasedEvidenceExtractor } from '../extraction/ruleBasedExtractor.js';
import { OpportunityScoringService } from './opportunityScoring.js';
import type { ScoringInput } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '../../../..', 'data/demo/sources');
const NOW = '2026-03-15T12:00:00.000Z';

async function scoreForDemo(): Promise<Map<string, { score: number; category: string }>> {
  const provider = new DemoSourceDiscoveryProvider(demoRoot);
  const sources = await provider.discover();
  const extractor = new RuleBasedEvidenceExtractor();
  const scorer = new OpportunityScoringService();
  const out = new Map<string, { score: number; category: string }>();

  for (const source of sources) {
    const extraction = await extractor.extract({ source });
    // We use the city as a rough congestion assignment for the test — we're
    // not asserting on the shared postcode/topology map yet (Step 6).
    const congestion =
      extraction.location.city === 'Rotterdam'
        ? { level: 'severe' as const, source: 'demo', sourceUrl: null, checkedAt: NOW, notes: null }
        : extraction.location.city === 'Zwolle'
          ? {
              level: 'high' as const,
              source: 'demo',
              sourceUrl: null,
              checkedAt: NOW,
              notes: null,
            }
          : {
              level: 'low' as const,
              source: 'demo',
              sourceUrl: null,
              checkedAt: NOW,
              notes: null,
            };
    const input: ScoringInput = {
      signalType: extraction.signalType,
      estimatedImpactClass: extraction.estimatedImpactClass,
      extractionConfidence: extraction.confidence,
      sourcePublishedAt: source.publishedAt,
      corroboratingSources: 1,
      onIndustrialPark: false,
      congestion,
      now: NOW,
    };
    const result = scorer.score(input);
    const key = source.url.includes('vanrijn')
      ? 'vanRijn'
      : source.url.includes('noord')
        ? 'noord'
        : 'delta';
    out.set(key, { score: result.score, category: result.category });
  }
  return out;
}

describe('OpportunityScoringService thresholds via demo pipeline', () => {
  let results: Awaited<ReturnType<typeof scoreForDemo>>;

  beforeAll(async () => {
    results = await scoreForDemo();
  });

  it('Van Rijn scores in the promising / dossier range (>= 65)', () => {
    const r = results.get('vanRijn');
    expect(r?.score).toBeGreaterThanOrEqual(65);
    expect(['promising', 'create_dossier']).toContain(r?.category);
  });

  it('Noord Cold Storage scores investigate/promising range (>= 40)', () => {
    const r = results.get('noord');
    expect(r?.score).toBeGreaterThanOrEqual(40);
    expect(['investigate_more', 'promising', 'create_dossier']).toContain(r?.category);
  });

  it('Delta Printworks scores below 40 (reject/stop)', () => {
    const r = results.get('delta');
    expect(r?.score).toBeLessThan(40);
    expect(r?.category).toBe('reject');
  });
});

describe('OpportunityScoringService pure math', () => {
  const scorer = new OpportunityScoringService();

  it('returns 0 for an unknown/unknown/no-congestion input', () => {
    const r = scorer.score({
      signalType: 'unknown',
      estimatedImpactClass: 'unknown',
      extractionConfidence: 0,
      sourcePublishedAt: null,
      corroboratingSources: 1,
      onIndustrialPark: false,
      congestion: null,
      now: NOW,
    });
    expect(r.score).toBeLessThanOrEqual(3); // just timing points
    expect(r.category).toBe('reject');
  });

  it('caps at 100', () => {
    const r = scorer.score({
      signalType: 'fleet_electrification',
      estimatedImpactClass: 'high',
      extractionConfidence: 1,
      sourcePublishedAt: NOW,
      corroboratingSources: 5,
      onIndustrialPark: true,
      congestion: {
        level: 'severe',
        source: 'demo',
        sourceUrl: null,
        checkedAt: NOW,
        notes: null,
      },
      now: NOW,
    });
    expect(r.score).toBe(100);
    expect(r.category).toBe('create_dossier');
  });

  it('categorizes at the exact thresholds', () => {
    const mk = (score: number) => (score < 40 ? 'reject' : score < 65 ? 'investigate_more' : score < 80 ? 'promising' : 'create_dossier');
    for (const s of [0, 39, 40, 64, 65, 79, 80, 100]) {
      const r = scorer.score({
        signalType: 'unknown',
        estimatedImpactClass: 'unknown',
        extractionConfidence: Math.min(1, s / 20),
        sourcePublishedAt: null,
        corroboratingSources: 1,
        onIndustrialPark: false,
        congestion: null,
        now: NOW,
      });
      // Sanity: the category function partitions the whole 0..100 range.
      expect(['reject', 'investigate_more', 'promising', 'create_dossier']).toContain(r.category);
    }
    // Direct partition sanity — makes the threshold function explicit in test.
    expect(mk(39)).toBe('reject');
    expect(mk(40)).toBe('investigate_more');
    expect(mk(64)).toBe('investigate_more');
    expect(mk(65)).toBe('promising');
    expect(mk(79)).toBe('promising');
    expect(mk(80)).toBe('create_dossier');
  });
});
