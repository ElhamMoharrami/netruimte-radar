import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@netruimte/shared';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  DemoSourceDiscoveryProvider,
  DisabledAutomationProvider,
  OpportunityDossierService,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
} from '@netruimte/core';
import { openDb, type Db } from '../persistence/index.js';
import { createRepositories } from '../persistence/index.js';
import { createApp } from '../app.js';
import type { AppContext, WiringReport } from '../context.js';

/**
 * Fixture: a complete autonomous run for Van Rijn Logistics, seeded directly.
 * Step 9 will produce this shape via the AutonomousRunService — this test
 * proves the routes surface it correctly and that the log entries retain
 * chronological order.
 */
async function seedAutonomousRun(db: Db) {
  const repos = createRepositories(db);
  const now = nowIso();

  const companyId = newId.company();
  await repos.companies.upsert({
    id: companyId,
    name: 'Van Rijn Logistics',
    website: 'https://vanrijn-logistics.example',
    address: 'Havenweg 1',
    city: 'Rotterdam',
    latitude: 51.9,
    longitude: 4.5,
    sector: 'logistics',
    sourceUrls: ['https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026'],
    createdAt: now,
    updatedAt: now,
  });

  const evidenceId = newId.evidence();
  await repos.evidence.insert({
    id: evidenceId,
    companyId,
    sourceUrl: 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026',
    sourceTitle: 'Van Rijn Logistics vernieuwt vloot met 35 elektrische trucks',
    sourceType: 'company_news',
    excerpt: '35 volledig elektrische vrachtwagens in gebruik',
    detectedAt: now,
    publishedAt: '2026-03-12T09:00:00.000Z',
    rawTextHash: 'demohash',
    confidence: 0.85,
  });

  const signalId = newId.signal();
  await repos.signals.insert({
    id: signalId,
    companyId,
    evidenceIds: [evidenceId],
    type: 'fleet_electrification',
    description: '35 electric trucks announced',
    estimatedImpactClass: 'high',
    confidence: 0.85,
    detectedAt: now,
  });

  const oppId = newId.opportunity();
  await repos.opportunities.insert({
    id: oppId,
    companyId,
    signalIds: [signalId],
    status: 'promising',
    score: 84,
    confidence: 0.85,
    congestionContext: {
      level: 'severe',
      source: 'DemoGridContextProvider',
      sourceUrl: 'https://capaciteitskaart.netbeheernederland.nl',
      checkedAt: now,
      notes: 'Demo dataset: Rotterdam port area constraints.',
    },
    gridNeighborStatus: 'unknown',
    recommendedNextStep: 'Compile preliminary dossier and queue for human review',
    createdAt: now,
    updatedAt: now,
  });

  const decisionId = newId.decision();
  await repos.decisions.insert({
    id: decisionId,
    opportunityId: oppId,
    decisionType: 'create_dossier',
    reason: 'Score >=65 and severe congestion',
    policyVersion: 'v0.1.0',
    createdAt: now,
  });

  // Seed a full ordered activity log — reflects what Step 9 will emit.
  const events: Array<{ type: string; message: string; delayMs: number }> = [
    { type: 'SCAN_STARTED', message: 'Scheduled scan started', delayMs: 0 },
    { type: 'SOURCE_DISCOVERED', message: '1 source discovered', delayMs: 1000 },
    { type: 'EVIDENCE_EXTRACTED', message: 'Evidence extracted', delayMs: 2000 },
    { type: 'SIGNAL_DETECTED', message: 'Signal fleet_electrification detected', delayMs: 3000 },
    { type: 'GRID_CONTEXT_CHECKED', message: 'Congestion severe (demo)', delayMs: 4000 },
    { type: 'OPPORTUNITY_SCORED', message: 'Score 84', delayMs: 5000 },
    { type: 'DECISION_MADE', message: 'Policy: create_dossier', delayMs: 6000 },
    { type: 'DOSSIER_CREATED', message: 'Preliminary dossier persisted', delayMs: 7000 },
  ];
  const t0 = Date.UTC(2026, 2, 15, 2, 0, 0);
  for (const [i, e] of events.entries()) {
    await repos.activity.append({
      id: newId.activity(),
      opportunityId: oppId,
      eventType: e.type as never,
      message: e.message,
      metadata: { step: i },
      createdAt: new Date(t0 + e.delayMs).toISOString(),
    });
  }

  return { companyId, oppId };
}

function makeCtx(repos: ReturnType<typeof createRepositories>): AppContext {
  const sources = new DemoSourceDiscoveryProvider('/dev/null');
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
    databaseProvider: 'sqlite',
    databaseProviderReason: 'test',
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
    resetDb: async () => undefined,
  };
}

describe('API routes with seeded autonomous run', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('lists opportunities', async () => {
    const { oppId } = await seedAutonomousRun(db);
    const repos = createRepositories(db);
    const app = createApp(makeCtx(repos));
    const res = await app.request('/api/opportunities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; score: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(oppId);
    expect(body.data[0]?.score).toBe(84);
  });

  it('returns detail with company + signals + decisions', async () => {
    const { oppId } = await seedAutonomousRun(db);
    const repos = createRepositories(db);
    const app = createApp(makeCtx(repos));
    const res = await app.request(`/api/opportunities/${oppId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opportunity: { score: number };
      company: { name: string };
      signals: unknown[];
      decisions: unknown[];
    };
    expect(body.company.name).toBe('Van Rijn Logistics');
    expect(body.opportunity.score).toBe(84);
    expect(body.signals).toHaveLength(1);
    expect(body.decisions).toHaveLength(1);
  });

  it('returns 404 for unknown opportunity', async () => {
    const repos = createRepositories(db);
    const app = createApp(makeCtx(repos));
    const res = await app.request('/api/opportunities/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns activity in chronological order', async () => {
    const { oppId } = await seedAutonomousRun(db);
    const repos = createRepositories(db);
    const app = createApp(makeCtx(repos));
    const res = await app.request(`/api/opportunities/${oppId}/activity`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activity: Array<{ eventType: string }> };
    const types = body.activity.map((a) => a.eventType);
    expect(types).toEqual([
      'SCAN_STARTED',
      'SOURCE_DISCOVERED',
      'EVIDENCE_EXTRACTED',
      'SIGNAL_DETECTED',
      'GRID_CONTEXT_CHECKED',
      'OPPORTUNITY_SCORED',
      'DECISION_MADE',
      'DOSSIER_CREATED',
    ]);
  });

  it('returns recent activity across all opportunities', async () => {
    await seedAutonomousRun(db);
    const repos = createRepositories(db);
    const app = createApp(makeCtx(repos));
    const res = await app.request('/api/activity/recent?limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ eventType: string }> };
    expect(body.data).toHaveLength(3);
    // Most recent first.
    expect(body.data[0]?.eventType).toBe('DOSSIER_CREATED');
  });

  /**
   * GET /api/companies feeds the Radar dashboard's "Businesses monitored"
   * tile. The count must reflect only real businesses ingested by the
   * business_signal pipeline — grid-operator sources (Liander/Enexis/Stedin)
   * must not appear here.
   */
  it('lists companies for the businesses-monitored dashboard tile', async () => {
    await seedAutonomousRun(db);
    const repos = createRepositories(db);
    const app = createApp(makeCtx(repos));
    const res = await app.request('/api/companies');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe('Van Rijn Logistics');
  });
});
