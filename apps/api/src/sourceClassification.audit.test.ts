/**
 * Source classification audit — end-to-end proofs for the live Apify pipeline.
 *
 * These tests answer the question "if we drop the exact URLs Apify actually
 * crawls into the run engine, do we route them correctly?". Each assertion
 * corresponds to one bullet in the audit contract:
 *
 *   Contract A — URL classifier
 *     • liander.nl / enexis.nl / stedin.net (+ subdomains) → grid_update
 *     • company / newsroom / sustainability pages           → business_signal
 *     • Apify's normalize() stamps sourceClass automatically
 *
 *   Contract B — Router invariants (AutonomousRunService.processSource)
 *     • Grid-update source: goes ONLY through GridUpdateExtractor.
 *     • Business source:    goes ONLY through EvidenceExtractor.
 *     • Grid source never creates a Company/Signal/Opportunity.
 *     • Business source never inserts a GridEvent.
 *
 *   Contract C — ActivityLog attribution
 *     • SOURCE_DISCOVERED.metadata.byClass has per-class counts.
 *     • EVIDENCE_EXTRACTED.metadata.sourceClass === 'business_signal'.
 *     • GRID_UPDATE_(DETECTED|CHANGED|UNCHANGED).metadata.sourceClass === 'grid_update'.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApifySourceDiscoveryProvider,
  AutonomousRunService,
  DemoGridContextProvider,
  DisabledAutomationProvider,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  classifyByUrl,
  type DiscoveredSource,
  type EvidenceExtractor,
  type ExtractionResult,
  type GridUpdateExtractor,
  type GridUpdateExtraction,
  type SourceDiscoveryProvider,
} from '@netruimte/core';
import { openDb, createRepositories, type Db } from './persistence/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

function stubProvider(name: string, docs: DiscoveredSource[]): SourceDiscoveryProvider {
  return { name, async discover() { return docs; } };
}

/** Records every source the extractor was asked to process. */
function spyEvidenceExtractor(): EvidenceExtractor & { calls: DiscoveredSource[] } {
  const inner = new RuleBasedEvidenceExtractor();
  const calls: DiscoveredSource[] = [];
  return {
    name: inner.name,
    calls,
    async extract(input): Promise<ExtractionResult> {
      calls.push(input.source);
      return inner.extract(input);
    },
  };
}

/** Records every source the grid extractor was asked to process. */
function spyGridUpdateExtractor(events: GridUpdateExtraction[]): GridUpdateExtractor & {
  calls: DiscoveredSource[];
} {
  const calls: DiscoveredSource[] = [];
  return {
    name: 'spy-grid-extractor',
    calls,
    async extract(input): Promise<GridUpdateExtraction[]> {
      calls.push(input.source);
      return events;
    },
  };
}

function buildService(
  db: Db,
  provider: SourceDiscoveryProvider,
  spies: { evidence: ReturnType<typeof spyEvidenceExtractor>; grid: ReturnType<typeof spyGridUpdateExtractor> },
) {
  const repos = createRepositories(db);
  return new AutonomousRunService({
    repos,
    sources: provider,
    extractor: spies.evidence,
    grid: new DemoGridContextProvider(),
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation: new DisabledAutomationProvider(),
    gridUpdateExtractor: spies.grid,
  });
}

// A realistic Liander-style extraction so the grid path actually persists
// a GridEvent — otherwise the "no double-classification" assertions become
// vacuous.
const LIANDER_EVENT: GridUpdateExtraction = {
  operator: 'liander',
  eventType: 'new_bottleneck',
  regions: ['Noord-Holland'],
  municipalities: ['Amsterdam'],
  stations: [],
  direction: 'consumption',
  summary: 'Liander: nieuw knelpunt afname Amsterdam',
  evidenceExcerpt: 'Voor afname is er een nieuw knelpunt in Amsterdam.',
  sourceUrl: 'https://www.liander.nl/nieuws/capaciteit-nh',
  publishedAt: '2026-02-10T10:00:00.000Z',
  confidence: 0.9,
  extractor: 'rule-based',
};

// ─── Contract A — URL classifier ──────────────────────────────────────────

describe('audit A — URL classifier maps grid operators to grid_update', () => {
  const GRID_URLS = [
    'https://www.liander.nl/nieuws/capaciteit',
    'https://liander.nl/',
    'https://capaciteit.liander.nl/regio/nh',
    'https://www.enexis.nl/netcapaciteit/afname',
    'https://transportkaart.enexis.nl/',
    'https://www.stedin.net/zakelijk/capaciteit',
  ];
  const BUSINESS_URLS = [
    'https://newsroom.postnl.nl/en-NL/259192-postnl-aims-to-develop-charging-hubs/',
    'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026',
    'https://acme.example/duurzaamheid',
    'https://example.com/',
    'https://not-liander.nl.example.com/',
    'https://enexis-fanpage.example/',
  ];

  it.each(GRID_URLS)('classifies %s as grid_update', (url) => {
    expect(classifyByUrl(url)).toBe('grid_update');
  });

  it.each(BUSINESS_URLS)('classifies %s as business_signal', (url) => {
    expect(classifyByUrl(url)).toBe('business_signal');
  });

  it('Apify provider auto-stamps sourceClass based on the loaded URL', async () => {
    // No actor run — feed a fake dataset via a stub fetch. Proves the field
    // is populated by the LIVE provider, not just by hand in tests.
    const stubFetch: typeof fetch = async (input) => {
      const u = typeof input === 'string' ? input : (input as URL | Request).toString();
      if (u.includes('/datasets/')) {
        const items = [
          { url: 'https://www.liander.nl/nieuws/x', text: 'Liander bericht' },
          { url: 'https://www.enexis.nl/afname', text: 'Enexis bericht' },
          { url: 'https://www.stedin.net/capaciteit', text: 'Stedin bericht' },
          {
            url: 'https://vanrijn-logistics.example/nieuws/elektrische-vloot',
            text: 'Van Rijn Logistics BV elektrische vloot',
          },
        ];
        return new Response(JSON.stringify(items), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };
    const provider = new ApifySourceDiscoveryProvider({
      token: 'test-token',
      actorId: 'unused',
      datasetId: 'fixed-dataset',
      fetchImpl: stubFetch,
    });
    const sources = await provider.discover();
    const byUrl = Object.fromEntries(sources.map((s) => [s.url, s.sourceClass]));
    expect(byUrl['https://www.liander.nl/nieuws/x']).toBe('grid_update');
    expect(byUrl['https://www.enexis.nl/afname']).toBe('grid_update');
    expect(byUrl['https://www.stedin.net/capaciteit']).toBe('grid_update');
    expect(byUrl['https://vanrijn-logistics.example/nieuws/elektrische-vloot']).toBe(
      'business_signal',
    );
  });
});

// ─── Contract B — router invariants ───────────────────────────────────────

describe('audit B — pipeline routes each class to exactly one extractor', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('grid_update source: only GridUpdateExtractor runs; no company/signal/opportunity created', async () => {
    const evidence = spyEvidenceExtractor();
    const grid = spyGridUpdateExtractor([LIANDER_EVENT]);
    const provider = stubProvider('test', [
      {
        url: 'https://www.liander.nl/nieuws/capaciteit-nh',
        title: 'Update capaciteit',
        rawText: 'Liander: nieuw knelpunt afname Amsterdam.',
        discoveredAt: new Date().toISOString(),
        publishedAt: '2026-02-10T10:00:00.000Z',
        sourceClass: 'grid_update',
        provider: 'test',
      },
    ]);
    const service = buildService(db, provider, { evidence, grid });
    const summary = await service.run({ trigger: 'manual' });

    // Extractor usage: exactly one grid call, zero evidence calls.
    expect(grid.calls).toHaveLength(1);
    expect(evidence.calls).toHaveLength(0);

    // Persistence side effects: one grid event, zero of everything else.
    const repos = createRepositories(db);
    const [companies, opps, signals, gridEvents] = await Promise.all([
      repos.companies.list(),
      repos.opportunities.list(),
      repos.signals.listByCompany('does-not-matter'),
      repos.gridEvents.list(),
    ]);
    expect(companies).toHaveLength(0);
    expect(opps).toHaveLength(0);
    expect(signals).toHaveLength(0);
    expect(gridEvents).toHaveLength(1);

    // Summary counters agree.
    expect(summary.gridUpdatesDetected).toBe(1);
    expect(summary.opportunitiesCreated).toBe(0);
    expect(summary.companiesProcessed).toBe(0);
    expect(summary.signalsDetected).toBe(0);
  });

  it('business_signal source: only EvidenceExtractor runs; no GridEvent ever inserted', async () => {
    const evidence = spyEvidenceExtractor();
    const grid = spyGridUpdateExtractor([LIANDER_EVENT]); // intentionally return events — must NOT be used
    const provider = stubProvider('test', [
      {
        url: 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026',
        title: 'Van Rijn Logistics vernieuwt vloot',
        rawText:
          'Van Rijn Logistics BV kondigt vandaag in Rotterdam aan dat het bedrijf 35 elektrische vrachtwagens in gebruik neemt.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'business_signal',
        provider: 'test',
      },
    ]);
    const service = buildService(db, provider, { evidence, grid });
    const summary = await service.run({ trigger: 'manual' });

    // Extractor usage: exactly one evidence call, ZERO grid calls.
    expect(evidence.calls).toHaveLength(1);
    expect(grid.calls).toHaveLength(0);

    // Persistence: business path yielded an opportunity, ZERO grid events.
    const repos = createRepositories(db);
    const gridEvents = await repos.gridEvents.list();
    expect(gridEvents).toHaveLength(0);
    expect(summary.opportunitiesCreated).toBe(1);
    expect(summary.gridUpdatesDetected).toBe(0);
  });

  it('mixed batch: each source goes to its own extractor, no crosstalk', async () => {
    const evidence = spyEvidenceExtractor();
    const grid = spyGridUpdateExtractor([LIANDER_EVENT]);
    const provider = stubProvider('test', [
      {
        url: 'https://www.stedin.net/zakelijk/capaciteit',
        title: 'Stedin',
        rawText: 'Stedin wachtlijst afname.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'grid_update',
        provider: 'test',
      },
      {
        url: 'https://vanrijn-logistics.example/nieuws/x',
        title: 'Van Rijn',
        rawText: 'Van Rijn Logistics BV zet elektrische vrachtwagens in te Rotterdam.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'business_signal',
        provider: 'test',
      },
    ]);
    const service = buildService(db, provider, { evidence, grid });
    const summary = await service.run({ trigger: 'manual' });

    expect(grid.calls.map((s) => s.url)).toEqual([
      'https://www.stedin.net/zakelijk/capaciteit',
    ]);
    expect(evidence.calls.map((s) => s.url)).toEqual([
      'https://vanrijn-logistics.example/nieuws/x',
    ]);
    expect(summary.gridUpdatesDetected).toBe(1);
    expect(summary.opportunitiesCreated).toBe(1);
  });
});

// ─── Contract C — ActivityLog identifies sourceClass ──────────────────────

describe('audit C — ActivityLog records sourceClass at every relevant hop', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('SOURCE_DISCOVERED metadata carries a per-class breakdown', async () => {
    const evidence = spyEvidenceExtractor();
    const grid = spyGridUpdateExtractor([LIANDER_EVENT]);
    const provider = stubProvider('test', [
      {
        url: 'https://www.liander.nl/x',
        title: 't',
        rawText: 'r',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'grid_update',
        provider: 'test',
      },
      {
        url: 'https://www.enexis.nl/y',
        title: 't',
        rawText: 'r',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'grid_update',
        provider: 'test',
      },
      {
        url: 'https://vanrijn-logistics.example/z',
        title: 't',
        rawText: 'Van Rijn Logistics BV zet elektrische vrachtwagens in te Rotterdam.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'business_signal',
        provider: 'test',
      },
    ]);
    const service = buildService(db, provider, { evidence, grid });
    await service.run({ trigger: 'manual' });

    const repos = createRepositories(db);
    const activity = await repos.activity.listRecent(500);
    const discovered = activity.find((a) => a.eventType === 'SOURCE_DISCOVERED')!;
    expect(discovered).toBeTruthy();
    expect(discovered.metadata).toMatchObject({
      count: 3,
      byClass: { grid_update: 2, business_signal: 1 },
    });
    // Human-readable message also carries the split.
    expect(discovered.message).toContain('business=1');
    expect(discovered.message).toContain('grid=2');
  });

  it('EVIDENCE_EXTRACTED.metadata.sourceClass === business_signal (never grid_update)', async () => {
    const evidence = spyEvidenceExtractor();
    const grid = spyGridUpdateExtractor([LIANDER_EVENT]);
    const provider = stubProvider('test', [
      {
        url: 'https://vanrijn-logistics.example/x',
        title: 'Van Rijn',
        rawText:
          'Van Rijn Logistics BV zet 35 elektrische vrachtwagens in te Rotterdam.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'business_signal',
        provider: 'test',
      },
    ]);
    const service = buildService(db, provider, { evidence, grid });
    await service.run({ trigger: 'manual' });

    const repos = createRepositories(db);
    const activity = await repos.activity.listRecent(500);
    const extracted = activity.filter((a) => a.eventType === 'EVIDENCE_EXTRACTED');
    expect(extracted).toHaveLength(1);
    expect((extracted[0]!.metadata as { sourceClass?: string }).sourceClass).toBe(
      'business_signal',
    );
  });

  it('GRID_UPDATE_DETECTED / CHANGED / UNCHANGED all carry sourceClass=grid_update', async () => {
    const evidence = spyEvidenceExtractor();
    // First run: fresh detection.
    const gridFirst = spyGridUpdateExtractor([LIANDER_EVENT]);
    const url = 'https://www.liander.nl/nieuws/capaciteit-nh';
    const providerFirst = stubProvider('test', [
      {
        url,
        title: 't',
        rawText: 'r',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'grid_update',
        provider: 'test',
      },
    ]);
    await buildService(db, providerFirst, { evidence, grid: gridFirst }).run({
      trigger: 'manual',
    });

    // Second run: identical event → UNCHANGED.
    const gridSame = spyGridUpdateExtractor([LIANDER_EVENT]);
    await buildService(db, providerFirst, { evidence, grid: gridSame }).run({
      trigger: 'manual',
    });

    // Third run: different event on same URL → CHANGED.
    const differentEvent: GridUpdateExtraction = {
      ...LIANDER_EVENT,
      municipalities: ['Zaanstad'],
      summary: 'Liander: nieuw knelpunt afname Zaanstad',
    };
    const gridChanged = spyGridUpdateExtractor([differentEvent]);
    await buildService(db, providerFirst, { evidence, grid: gridChanged }).run({
      trigger: 'manual',
    });

    const repos = createRepositories(db);
    const activity = await repos.activity.listRecent(500);
    const detected = activity.filter((a) => a.eventType === 'GRID_UPDATE_DETECTED');
    const unchanged = activity.filter((a) => a.eventType === 'GRID_UPDATE_UNCHANGED');
    const changed = activity.filter((a) => a.eventType === 'GRID_UPDATE_CHANGED');
    expect(detected).toHaveLength(1);
    expect(unchanged).toHaveLength(1);
    expect(changed).toHaveLength(1);
    for (const entry of [...detected, ...unchanged, ...changed]) {
      expect((entry.metadata as { sourceClass?: string }).sourceClass).toBe('grid_update');
    }
  });
});
