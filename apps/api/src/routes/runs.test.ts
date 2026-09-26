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

function buildContext(db: Db): AppContext {
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
    dossierService,
    wiring,
    buildOfflineRunService: () => runService,
    resetDb: () => undefined,
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
