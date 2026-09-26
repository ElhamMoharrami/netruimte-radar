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
import { createApp } from './app.js';
import type { AppContext, WiringReport } from './context.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

function stubProvider(name: string, docs: DiscoveredSource[]): SourceDiscoveryProvider {
  return {
    name,
    async discover() {
      return docs;
    },
  };
}

function makeCtx(db: Db, provider?: SourceDiscoveryProvider): AppContext {
  const repos = createRepositories(db);
  const sources = provider ?? stubProvider('empty', []);
  const extractor = new RuleBasedEvidenceExtractor();
  const grid = new DemoGridContextProvider();
  const automation = new DisabledAutomationProvider();
  const runService = new AutonomousRunService({
    repos,
    sources,
    extractor,
    grid,
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation,
  });
  const wiring: WiringReport = {
    demoMode: true,
    extractor: extractor.name,
    extractorReason: 'test',
    sourceProvider: sources.name,
    sourceProviderReason: 'test',
    automationProvider: automation.name,
    automationProviderReason: 'test',
    notificationAllowlist: 0,
    scheduledEndpointEnabled: false,
    aiProvider: 'rules',
    gridProvider: 'demo',
    gridProviderReason: 'test',
  };
  return {
    repos,
    demoMode: true,
    serviceToken: null,
    sources,
    extractor,
    grid,
    automation,
    runService,
    dossierService: { getForOpportunity: async () => null } as unknown as AppContext['dossierService'],
    wiring,
    buildOfflineRunService: () => runService,
    resetDb: () => undefined,
  };
}

function fakeGridEvent(overrides: Partial<GridEvent> = {}): GridEvent {
  const base: GridEvent = {
    id: newId.gridEvent(),
    operator: 'liander',
    eventType: 'new_bottleneck',
    regions: ['Noord-Holland'],
    municipalities: ['Amsterdam'],
    stations: ['Krommenie'],
    direction: 'consumption',
    summary: 'Liander: new_bottleneck — in Amsterdam',
    evidenceExcerpt: 'Voor afname is er een nieuw knelpunt in Amsterdam.',
    sourceUrl: 'https://www.liander.nl/nieuws/x',
    publishedAt: '2026-02-10T10:00:00.000Z',
    detectedAt: nowIso(),
    confidence: 0.9,
    contentHash: 'placeholder',
    ...overrides,
  };
  return {
    ...base,
    contentHash: computeGridEventContentHash(base),
  };
}

const LIANDER_HTML = `# Update capaciteitskaart

## Noord-Holland — nieuw knelpunt in Amsterdam
Voor afname is er een nieuw knelpunt in Amsterdam. Klanten worden opgenomen op de wachtlijst.
Ook onderstation Krommenie is beperkt.
`;

const LIANDER_HTML_CHANGED = `# Update capaciteitskaart

## Flevoland — extra capaciteit beschikbaar
In Flevoland is extra capaciteit beschikbaar voor teruglevering.
`;

// ─── computeGridEventContentHash unit tests ────────────────────────────────

describe('computeGridEventContentHash', () => {
  it('is stable for the same identity fields (order-independent arrays)', () => {
    const a = computeGridEventContentHash({
      operator: 'liander',
      eventType: 'new_bottleneck',
      regions: ['Noord-Holland'],
      municipalities: ['Amsterdam', 'Zaanstad'],
      stations: ['Krommenie'],
      direction: 'consumption',
    });
    const b = computeGridEventContentHash({
      operator: 'liander',
      eventType: 'new_bottleneck',
      regions: ['Noord-Holland'],
      municipalities: ['Zaanstad', 'Amsterdam'],
      stations: ['Krommenie'],
      direction: 'consumption',
    });
    expect(a).toBe(b);
  });

  it('changes when any identity field changes', () => {
    const base = {
      operator: 'liander' as const,
      eventType: 'new_bottleneck' as const,
      regions: ['Noord-Holland'],
      municipalities: ['Amsterdam'],
      stations: ['Krommenie'],
      direction: 'consumption' as const,
    };
    const hash = computeGridEventContentHash(base);
    expect(computeGridEventContentHash({ ...base, eventType: 'capacity_released' })).not.toBe(hash);
    expect(computeGridEventContentHash({ ...base, direction: 'both' })).not.toBe(hash);
    expect(computeGridEventContentHash({ ...base, municipalities: ['Rotterdam'] })).not.toBe(hash);
    expect(computeGridEventContentHash({ ...base, stations: [] })).not.toBe(hash);
    expect(computeGridEventContentHash({ ...base, regions: ['Zuid-Holland'] })).not.toBe(hash);
    expect(computeGridEventContentHash({ ...base, operator: 'stedin' })).not.toBe(hash);
  });

  it('does NOT depend on summary/excerpt/publishedAt/detectedAt', () => {
    // Building GridEvents that share identity but differ on prose fields:
    const a = fakeGridEvent({ summary: 'A', evidenceExcerpt: 'a', publishedAt: '2020-01-01T00:00:00Z' });
    const b = fakeGridEvent({ summary: 'B', evidenceExcerpt: 'b', publishedAt: '2026-12-31T00:00:00Z' });
    expect(a.contentHash).toBe(b.contentHash);
  });
});

// ─── GridEventRepository ──────────────────────────────────────────────────

describe('GridEventRepository', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('inserts + finds by id', async () => {
    const repos = createRepositories(db);
    const e = fakeGridEvent();
    await repos.gridEvents.insert(e);
    const found = await repos.gridEvents.findById(e.id);
    expect(found).not.toBeNull();
    expect(found!.contentHash).toBe(e.contentHash);
    expect(found!.municipalities).toEqual(['Amsterdam']);
  });

  it('findBySourceAndHash returns the exact match', async () => {
    const repos = createRepositories(db);
    const url = 'https://www.liander.nl/nieuws/x';
    const e = fakeGridEvent({ sourceUrl: url });
    await repos.gridEvents.insert(e);
    expect(await repos.gridEvents.findBySourceAndHash(url, e.contentHash)).not.toBeNull();
    expect(await repos.gridEvents.findBySourceAndHash(url, 'other-hash')).toBeNull();
    expect(await repos.gridEvents.findBySourceAndHash('https://other.url/', e.contentHash)).toBeNull();
  });

  it('findLatestBySourceUrl returns the most recent event for a url', async () => {
    const repos = createRepositories(db);
    const url = 'https://www.liander.nl/nieuws/x';
    const older = fakeGridEvent({
      sourceUrl: url,
      detectedAt: '2026-01-01T00:00:00.000Z',
      eventType: 'new_bottleneck',
    });
    const newer = fakeGridEvent({
      sourceUrl: url,
      detectedAt: '2026-02-01T00:00:00.000Z',
      eventType: 'capacity_released',
    });
    await repos.gridEvents.insert(older);
    await repos.gridEvents.insert(newer);
    const latest = await repos.gridEvents.findLatestBySourceUrl(url);
    expect(latest?.id).toBe(newer.id);
  });

  it('list returns most-recent first', async () => {
    const repos = createRepositories(db);
    const older = fakeGridEvent({ detectedAt: '2026-01-01T00:00:00.000Z' });
    const newer = fakeGridEvent({
      detectedAt: '2026-02-01T00:00:00.000Z',
      sourceUrl: 'https://www.stedin.net/y',
    });
    await repos.gridEvents.insert(older);
    await repos.gridEvents.insert(newer);
    const rows = await repos.gridEvents.list(10);
    expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
  });
});

// ─── Dedup in AutonomousRunService.processGridUpdateSource ────────────────

describe('AutonomousRunService — grid dedup + activity logging', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  function gridSource(url: string, rawText: string): DiscoveredSource {
    return {
      url,
      title: 'grid',
      rawText,
      discoveredAt: nowIso(),
      publishedAt: null,
      sourceClass: 'grid_update',
      provider: 'test',
    };
  }

  it('first scan → GRID_UPDATE_DETECTED + inserts one grid event', async () => {
    const ctx = makeCtx(
      db,
      stubProvider('t', [gridSource('https://www.liander.nl/x', LIANDER_HTML)]),
    );
    const summary = await ctx.runService.run({ trigger: 'manual' });
    expect(summary.gridUpdatesDetected).toBe(1);
    const stored = await ctx.repos.gridEvents.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.operator).toBe('liander');
    expect(stored[0]!.eventType).toBe('new_bottleneck');

    const activity = await ctx.repos.activity.listRecent(200);
    const types = activity.map((a) => a.eventType);
    expect(types).toContain('GRID_UPDATE_DETECTED');
    expect(types).not.toContain('GRID_UPDATE_UNCHANGED');
    expect(types).not.toContain('GRID_UPDATE_CHANGED');
  });

  it('re-scan of an unchanged page → GRID_UPDATE_UNCHANGED, no new insert', async () => {
    const provider = stubProvider('t', [gridSource('https://www.liander.nl/x', LIANDER_HTML)]);
    const ctx = makeCtx(db, provider);
    await ctx.runService.run({ trigger: 'manual' });
    await ctx.runService.run({ trigger: 'manual' });

    const stored = await ctx.repos.gridEvents.list();
    expect(stored).toHaveLength(1);

    const activity = await ctx.repos.activity.listRecent(400);
    const types = activity.map((a) => a.eventType);
    expect(types.filter((t) => t === 'GRID_UPDATE_DETECTED')).toHaveLength(1);
    expect(types.filter((t) => t === 'GRID_UPDATE_UNCHANGED')).toHaveLength(1);
    expect(types).not.toContain('GRID_UPDATE_CHANGED');
  });

  it('re-scan of a changed page → GRID_UPDATE_CHANGED + inserts a new event', async () => {
    // 1st run: original page
    const original = stubProvider('t', [gridSource('https://www.liander.nl/x', LIANDER_HTML)]);
    const ctx = makeCtx(db, original);
    await ctx.runService.run({ trigger: 'manual' });

    // 2nd run: SAME url, DIFFERENT body (different identity fields → different hash)
    const rerunService = new AutonomousRunService({
      repos: ctx.repos,
      sources: stubProvider('t', [gridSource('https://www.liander.nl/x', LIANDER_HTML_CHANGED)]),
      extractor: new RuleBasedEvidenceExtractor(),
      grid: new DemoGridContextProvider(),
      scoring: new OpportunityScoringService(),
      policy: new PolicyEngine(),
      automation: new DisabledAutomationProvider(),
    });
    await rerunService.run({ trigger: 'manual' });

    const stored = await ctx.repos.gridEvents.list();
    expect(stored).toHaveLength(2);

    const activity = await ctx.repos.activity.listRecent(400);
    const types = activity.map((a) => a.eventType);
    expect(types.filter((t) => t === 'GRID_UPDATE_DETECTED')).toHaveLength(1);
    expect(types.filter((t) => t === 'GRID_UPDATE_CHANGED')).toHaveLength(1);
    expect(types).not.toContain('GRID_UPDATE_UNCHANGED');
  });
});

// ─── GET /api/grid-events routes ───────────────────────────────────────────

describe('GET /api/grid-events', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('lists persisted events most-recent first', async () => {
    const ctx = makeCtx(db);
    const app = createApp(ctx);
    const older = fakeGridEvent({ detectedAt: '2026-01-01T00:00:00.000Z' });
    const newer = fakeGridEvent({
      detectedAt: '2026-02-01T00:00:00.000Z',
      sourceUrl: 'https://www.stedin.net/y',
    });
    await ctx.repos.gridEvents.insert(older);
    await ctx.repos.gridEvents.insert(newer);

    const res = await app.request('/api/grid-events');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((d) => d.id)).toEqual([newer.id, older.id]);
  });

  it('respects the limit query param (clamped to 1..500)', async () => {
    const ctx = makeCtx(db);
    const app = createApp(ctx);
    for (let i = 0; i < 3; i++) {
      await ctx.repos.gridEvents.insert(
        fakeGridEvent({
          sourceUrl: `https://www.liander.nl/x?i=${i}`,
          detectedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
        }),
      );
    }
    const res = await app.request('/api/grid-events?limit=2');
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it('GET /api/grid-events/:id returns 200 with the event', async () => {
    const ctx = makeCtx(db);
    const app = createApp(ctx);
    const e = fakeGridEvent();
    await ctx.repos.gridEvents.insert(e);
    const res = await app.request(`/api/grid-events/${e.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { id: string; operator: string } };
    expect(body.event.id).toBe(e.id);
    expect(body.event.operator).toBe('liander');
  });

  it('GET /api/grid-events/:id returns 404 for an unknown id', async () => {
    const ctx = makeCtx(db);
    const app = createApp(ctx);
    const res = await app.request('/api/grid-events/gev_does-not-exist');
    expect(res.status).toBe(404);
  });
});
