import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  DisabledAutomationProvider,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  computeGridEventContentHash,
  type DiscoveredSource,
  type SourceDiscoveryProvider,
} from '@netruimte/core';
import { newId, nowIso, type GridEvent } from '@netruimte/shared';
import { openDb, createRepositories, type Db } from './persistence/index.js';

function stubProvider(name: string, docs: DiscoveredSource[]): SourceDiscoveryProvider {
  return { name, async discover() { return docs; } };
}

function seedGridEvent(overrides: Partial<GridEvent>): GridEvent {
  const base: GridEvent = {
    id: newId.gridEvent(),
    operator: 'stedin',
    eventType: 'new_bottleneck',
    regions: ['Zuid-Holland'],
    municipalities: ['Rotterdam'],
    stations: [],
    direction: 'consumption',
    summary: 'Stedin: new_bottleneck — in Rotterdam',
    evidenceExcerpt: 'Voor afname is er een nieuw knelpunt in Rotterdam.',
    sourceUrl: 'https://www.stedin.net/x',
    publishedAt: null,
    detectedAt: nowIso(),
    confidence: 0.9,
    contentHash: 'placeholder',
    ...overrides,
  };
  return { ...base, contentHash: computeGridEventContentHash(base) };
}

const VAN_RIJN_SOURCE: DiscoveredSource = {
  url: 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026',
  title: 'Van Rijn Logistics vernieuwt vloot met 35 elektrische trucks',
  rawText:
    'Van Rijn Logistics BV kondigt vandaag in Rotterdam aan dat het bedrijf 35 elektrische vrachtwagens in gebruik neemt en een snellaadplein aanlegt.',
  discoveredAt: new Date().toISOString(),
  publishedAt: '2026-03-12T09:00:00.000Z',
  sourceType: 'company_news',
  sourceClass: 'business_signal',
  provider: 'test',
};

function buildService(db: Db, source: DiscoveredSource) {
  const repos = createRepositories(db);
  const service = new AutonomousRunService({
    repos,
    sources: stubProvider('test', [source]),
    extractor: new RuleBasedEvidenceExtractor(),
    grid: new DemoGridContextProvider(),
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation: new DisabledAutomationProvider(),
  });
  return { service, repos };
}

describe('AutonomousRunService — grid correlation into scoring', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('no matching grid event → no correlation bonus (baseline score)', async () => {
    const { service, repos } = buildService(db, VAN_RIJN_SOURCE);
    await service.run({ trigger: 'manual' });

    const opps = await repos.opportunities.list();
    expect(opps).toHaveLength(1);
    const baseline = opps[0]!.score;

    const activity = await repos.activity.listRecent(200);
    const scored = activity.find((a) => a.eventType === 'OPPORTUNITY_SCORED');
    expect(scored).toBeDefined();
    const meta = scored!.metadata as Record<string, unknown>;
    const gc = meta.gridEventCorrelation as { bonus: number; matchedEventIds: string[] };
    expect(gc.bonus).toBe(0);
    expect(gc.matchedEventIds).toEqual([]);
    return baseline;
  });

  it('one municipality-matching recent grid event → +10 vs baseline, and matched event id is logged', async () => {
    // First run: no grid event yet — baseline.
    const b = buildService(db, VAN_RIJN_SOURCE);
    await b.service.run({ trigger: 'manual' });
    const baselineOpp = (await b.repos.opportunities.list())[0]!;
    const baseline = baselineOpp.score;

    // Fresh in-memory DB for the correlated scenario.
    const db2 = openDb({ path: ':memory:' });
    try {
      const { service, repos } = buildService(db2, VAN_RIJN_SOURCE);
      // Seed a recent Rotterdam grid event BEFORE running.
      const seeded = seedGridEvent({
        detectedAt: new Date().toISOString(),
      });
      await repos.gridEvents.insert(seeded);
      await service.run({ trigger: 'manual' });

      const opp = (await repos.opportunities.list())[0]!;
      // Rule-based extractor picks up Rotterdam from the fixture; DemoGrid returns 'severe' for
      // Rotterdam either way, so the ONLY delta vs baseline is the correlation bonus.
      expect(opp.score).toBeGreaterThanOrEqual(baseline);
      expect(opp.score - baseline).toBeGreaterThanOrEqual(1);
      expect(opp.score - baseline).toBeLessThanOrEqual(15);

      const activity = await repos.activity.listRecent(400);
      const scored = activity.find((a) => a.eventType === 'OPPORTUNITY_SCORED');
      const meta = scored!.metadata as Record<string, unknown>;
      const gc = meta.gridEventCorrelation as {
        bonus: number;
        confidence: number;
        matchedEventIds: string[];
        matchedEventSummaries: Array<{ sourceUrl: string }>;
        explanation: string;
      };
      expect(gc.bonus).toBeGreaterThanOrEqual(1);
      expect(gc.confidence).toBe(0.9);
      expect(gc.matchedEventIds).toEqual([seeded.id]);
      expect(gc.matchedEventSummaries[0]?.sourceUrl).toBe(seeded.sourceUrl);
      expect(gc.explanation).toMatch(/mention/i);
      expect(gc.explanation).toMatch(/does NOT imply grid-neighbor topology/i);
    } finally {
      db2.close();
    }
  });

  it('grid event in a different city → 0 bonus, non-empty explanation', async () => {
    const { service, repos } = buildService(db, VAN_RIJN_SOURCE);
    // Seed an event that mentions a different city + different region.
    await repos.gridEvents.insert(
      seedGridEvent({
        municipalities: ['Amsterdam'],
        regions: ['Noord-Holland'],
        summary: 'Liander: new_bottleneck — in Amsterdam',
        operator: 'liander',
        sourceUrl: 'https://www.liander.nl/x',
        detectedAt: new Date().toISOString(),
      }),
    );
    await service.run({ trigger: 'manual' });

    const activity = await repos.activity.listRecent(200);
    const scored = activity.find((a) => a.eventType === 'OPPORTUNITY_SCORED');
    const gc = (scored!.metadata as Record<string, unknown>).gridEventCorrelation as {
      bonus: number;
      matchedEventIds: string[];
      explanation: string;
    };
    expect(gc.bonus).toBe(0);
    expect(gc.matchedEventIds).toEqual([]);
    expect(gc.explanation).toMatch(/no recent grid_update events mention/i);
  });
});
