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
    db,
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

// ─── Trigger attribution — full trace ────────────────────────────────────
//
// Regression guard: production scans triggered from the live UI / scheduled
// flow were being persisted with `trigger: "demo"`, polluting the `/runs`
// history operators rely on to answer "how did the cron do last night?".
//
// Each test follows the trigger through EVERY sink so a future regression
// at any layer (route → service → run history → activity log) fails loudly:
//   1. RunHistory row      (routes → AutonomousRunService.finalizeRun)
//   2. SCAN_STARTED entry  (AutonomousRunService.run → activity metadata + message)
//   3. SCAN_COMPLETED entry(AutonomousRunService.finalizeRun → metadata.summary)
//
// Contract:
//   POST /api/runs/demo                       → 'manual'
//   POST /api/runs/demo?offline=true          → 'offline'
//   POST /api/runs/scheduled (valid token)    → 'scheduled'
//   POST /api/runs/scheduled?offline=true     → 'offline'
//   POST /api/demo/overnight-scan             → 'demo'

interface ActivityRow {
  eventType: string;
  message: string;
  metadata: Record<string, unknown> | null;
}

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

  async function activity(app: ReturnType<typeof createApp>): Promise<ActivityRow[]> {
    const res = await app.request('/api/activity/recent?limit=500');
    const body = (await res.json()) as { data: ActivityRow[] };
    return body.data;
  }

  /**
   * Prove the trigger appears verbatim in all three sinks fed by a single
   * `AutonomousRunService.run()` call. If any assertion fires, the trigger
   * was dropped or rewritten somewhere along the route → service → log path.
   */
  async function assertTriggerTracesTo(
    app: ReturnType<typeof createApp>,
    expected: 'manual' | 'scheduled' | 'demo' | 'offline',
    expectedNotes: string | null,
  ) {
    const run = await latestRun(app);
    expect(run.trigger, 'RunHistory.trigger').toBe(expected);
    expect(run.notes, 'RunHistory.notes').toBe(expectedNotes);

    const entries = await activity(app);
    const started = entries.find((e) => e.eventType === 'SCAN_STARTED');
    const completed = entries.find((e) => e.eventType === 'SCAN_COMPLETED');
    expect(started, 'SCAN_STARTED activity entry').toBeTruthy();
    expect(completed, 'SCAN_COMPLETED activity entry').toBeTruthy();

    // SCAN_STARTED writes trigger to both message text and metadata.
    expect(started!.message, 'SCAN_STARTED message text').toContain(`trigger=${expected}`);
    expect(
      (started!.metadata as { trigger?: string } | null)?.trigger,
      'SCAN_STARTED metadata.trigger',
    ).toBe(expected);

    // SCAN_COMPLETED carries the full summary — trigger is nested one level in.
    const completedSummary = (completed!.metadata as { summary?: { trigger?: string } } | null)
      ?.summary;
    expect(completedSummary?.trigger, 'SCAN_COMPLETED metadata.summary.trigger').toBe(expected);
  }

  it('POST /api/runs/demo → "manual" traces to RunHistory + both activity entries', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);
    const res = await app.request('/api/runs/demo', { method: 'POST' });
    expect(res.status).toBe(200);
    await assertTriggerTracesTo(app, 'manual', null);
  });

  it('POST /api/runs/demo?offline=true → "offline" traces to RunHistory + both activity entries', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);
    const res = await app.request('/api/runs/demo?offline=true', { method: 'POST' });
    expect(res.status).toBe(200);
    await assertTriggerTracesTo(app, 'offline', 'offline mode');
  });

  it('POST /api/runs/scheduled (valid token) → "scheduled" traces to RunHistory + both activity entries', async () => {
    const ctx = buildContext(db, { serviceToken: 'secret' });
    const app = createApp(ctx);
    const res = await app.request('/api/runs/scheduled', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(200);
    await assertTriggerTracesTo(app, 'scheduled', null);
  });

  it('POST /api/runs/scheduled?offline=true (valid token) → "offline" traces to RunHistory + both activity entries', async () => {
    const ctx = buildContext(db, { serviceToken: 'secret' });
    const app = createApp(ctx);
    const res = await app.request('/api/runs/scheduled?offline=true', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(200);
    await assertTriggerTracesTo(app, 'offline', 'offline mode');
  });

  it('POST /api/demo/overnight-scan → "demo" traces to RunHistory + both activity entries (not "scheduled")', async () => {
    const ctx = buildContext(db);
    const app = createApp(ctx);
    const res = await app.request('/api/demo/overnight-scan', { method: 'POST' });
    expect(res.status).toBe(200);
    await assertTriggerTracesTo(app, 'demo', 'demo overnight scan');
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
