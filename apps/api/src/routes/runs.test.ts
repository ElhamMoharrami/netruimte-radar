import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  DemoSourceDiscoveryProvider,
  LocalAutomationProvider,
  OpportunityDossierService,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
} from '@netruimte/core';
import { openDb, createRepositories, type Db } from '../persistence/index.js';
import { createApp } from '../app.js';
import type { AppContext, WiringReport } from '../context.js';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '../../../../data/demo/sources');

function buildContext(
  db: Db,
  opts: { serviceToken?: string | null } = {},
): AppContext {
  const repos = createRepositories(db);
  const sources = new DemoSourceDiscoveryProvider(demoRoot);
  const extractor = new RuleBasedEvidenceExtractor();
  const grid = new DemoGridContextProvider();
  const automation = new LocalAutomationProvider();
  const runService = new AutonomousRunService({
    repos,
    sources,
    extractor,
    grid,
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation,
  });
  const dossierService = new OpportunityDossierService(repos);
  const serviceToken = opts.serviceToken ?? null;
  const wiring: WiringReport = {
    demoMode: true,
    extractor: extractor.name,
    extractorReason: 'test',
    sourceProvider: sources.name,
    sourceProviderReason: 'test',
    automationProvider: automation.name,
    automationProviderReason: 'test',
    notificationAllowlist: 0,
    scheduledEndpointEnabled: Boolean(serviceToken),
    aiProvider: 'rules',
    gridProvider: 'demo',
    gridProviderReason: 'test',
    databaseProvider: 'sqlite',
    databaseProviderReason: 'test',
  };
  return {
    repos,
    demoMode: true,
    serviceToken,
    sources,
    extractor,
    grid,
    automation,
    runService,
    dossierService,
    wiring,
    buildOfflineRunService: () => runService,
    resetDb: async () => undefined,
  };
}

describe('POST /api/runs/demo — full autonomous pipeline', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('processes all 3 demo sources and produces one opportunity per real signal', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);

    const res = await app.request('/api/runs/demo', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: {
        sourcesDiscovered: number;
        opportunitiesCreated: number;
        decisions: Record<string, number>;
        actionsDispatched: number;
        failures: number;
      };
    };

    expect(body.summary.sourcesDiscovered).toBe(3);
    // Delta Printworks is low-signal but should still yield an opportunity —
    // it's just rejected by policy. All three companies are identifiable.
    expect(body.summary.opportunitiesCreated).toBeGreaterThanOrEqual(3);
    expect(body.summary.failures).toBe(0);
    // At least one dossier decision from the high-score Van Rijn.
    expect(body.summary.decisions.create_dossier).toBeGreaterThanOrEqual(1);
    // At least one stop from the low-score Delta.
    expect(body.summary.decisions.stop).toBeGreaterThanOrEqual(1);
  });

  it('emits a coherent activity feed per opportunity', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);

    await app.request('/api/runs/demo', { method: 'POST' });

    const listRes = await app.request('/api/opportunities');
    const list = (await listRes.json()) as { data: Array<{ id: string; score: number }> };
    expect(list.data.length).toBeGreaterThanOrEqual(3);

    // Pick the highest-scoring one (Van Rijn) and check its activity feed.
    const top = [...list.data].sort((a, b) => b.score - a.score)[0]!;
    const actRes = await app.request(`/api/opportunities/${top.id}/activity`);
    const act = (await actRes.json()) as { activity: Array<{ eventType: string }> };
    const types = act.activity.map((a) => a.eventType);
    expect(types).toContain('SIGNAL_DETECTED');
    expect(types).toContain('GRID_CONTEXT_CHECKED');
    expect(types).toContain('OPPORTUNITY_SCORED');
    expect(types).toContain('DECISION_MADE');
    // Van Rijn: severe congestion + high score → dossier + local action.
    expect(types).toContain('DOSSIER_CREATED');
    expect(types).toContain('ACTION_DISPATCHED');
  });

  it('exposes the wiring report so the dashboard can show which providers are live', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);
    const res = await app.request('/api/wiring');
    const body = (await res.json()) as WiringReport;
    expect(body.demoMode).toBe(true);
    expect(body.extractor).toBe('rule-based');
    expect(body.sourceProvider).toBe('demo');
    expect(body.automationProvider).toBe('local');
  });
});

// ─── Trigger attribution ──────────────────────────────────────────────────
//
// Regression guard: production scans triggered from the live UI / scheduled
// flow were being persisted with `trigger: "demo"`, polluting the `/runs`
// history operators rely on to answer "how did the cron do last night?".
//
// Contract:
//   POST /api/runs/demo                       → 'manual'
//   POST /api/runs/demo?offline=true          → 'offline'
//   POST /api/runs/scheduled (valid token)    → 'scheduled'
//   POST /api/runs/scheduled?offline=true     → 'offline'
//   POST /api/demo/overnight-scan             → 'demo'

describe('run trigger attribution', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  async function latestRun(app: ReturnType<typeof createApp>) {
    const res = await app.request('/api/runs?limit=1');
    const body = (await res.json()) as { data: Array<{ trigger: string; notes: string | null }> };
    return body.data[0]!;
  }

  it('POST /api/runs/demo → persists trigger="manual" (live UI scan)', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);
    const res = await app.request('/api/runs/demo', { method: 'POST' });
    expect(res.status).toBe(200);
    const run = await latestRun(app);
    expect(run.trigger).toBe('manual');
    expect(run.notes).toBeNull();
  });

  it('POST /api/runs/demo?offline=true → persists trigger="offline"', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);
    const res = await app.request('/api/runs/demo?offline=true', { method: 'POST' });
    expect(res.status).toBe(200);
    const run = await latestRun(app);
    expect(run.trigger).toBe('offline');
    expect(run.notes).toBe('offline mode');
  });

  it('POST /api/runs/scheduled with valid token → persists trigger="scheduled"', async () => {
    const ctx = buildContext(db, { serviceToken: 'secret' });
    const app = createApp(ctx);
    const res = await app.request('/api/runs/scheduled', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(200);
    const run = await latestRun(app);
    expect(run.trigger).toBe('scheduled');
    expect(run.notes).toBeNull();
  });

  it('POST /api/runs/scheduled?offline=true with valid token → persists trigger="offline"', async () => {
    const ctx = buildContext(db, { serviceToken: 'secret' });
    const app = createApp(ctx);
    const res = await app.request('/api/runs/scheduled?offline=true', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(200);
    const run = await latestRun(app);
    expect(run.trigger).toBe('offline');
    expect(run.notes).toBe('offline mode');
  });

  it('POST /api/demo/overnight-scan → persists trigger="demo" (not "scheduled")', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);
    const res = await app.request('/api/demo/overnight-scan', { method: 'POST' });
    expect(res.status).toBe(200);
    const run = await latestRun(app);
    expect(run.trigger).toBe('demo');
    expect(run.notes).toBe('demo overnight scan');
  });

  it('POST /api/runs/scheduled without token → 401 (no run persisted)', async () => {
    // Sanity guard: auth failure must not silently produce a mis-attributed
    // row. If this ever flips to 200, the regression is not just attribution
    // but the whole scheduled-endpoint contract.
    const ctx = buildContext(db, { serviceToken: 'secret' });
    const app = createApp(ctx);
    const res = await app.request('/api/runs/scheduled', { method: 'POST' });
    expect(res.status).toBe(401);
    const listRes = await app.request('/api/runs?limit=10');
    const list = (await listRes.json()) as { data: unknown[] };
    expect(list.data).toHaveLength(0);
  });
});
