/**
 * Tests for the TEMPORARY GET /api/admin/run-diagnostics/:runId endpoint.
 *
 * Contract:
 *   - Auth: 503 when no SERVICE_TOKEN configured; 401 when header missing
 *     or wrong; 200 when the header matches.
 *   - Response shape: { runId, failureSplit, failureDetails, runTrace,
 *     actionQueueCounts }.
 *   - Read-only: exercising the endpoint must not mutate any table.
 *
 * Delete alongside `routes/adminDiagnostics.ts` when the mis-attributed-
 * failures investigation is closed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityLog, Company, Opportunity, QueuedAction } from '@netruimte/shared';
import { openDb, createRepositories, type Db } from '../persistence/index.js';
import { createApp } from '../app.js';
import type { AppContext, WiringReport } from '../context.js';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  DisabledAutomationProvider,
  OpportunityDossierService,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  DemoSourceDiscoveryProvider,
} from '@netruimte/core';

function ctxWithToken(db: Db, serviceToken: string | null): AppContext {
  const repos = createRepositories(db);
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
    scheduledEndpointEnabled: Boolean(serviceToken),
    aiProvider: 'rules',
    gridProvider: 'demo',
    gridProviderReason: 'test',
    databaseProvider: 'sqlite',
    databaseProviderReason: 'test',
    automationWebhookConfigured: false,
    automationWebhookHost: null,
    automationWebhookPath: null,
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

const RUN_ID = 'act_test_run_1';
const OTHER_RUN_ID = 'act_test_run_2';

/**
 * Seed a controlled activity_log + action_queue snapshot that exercises the
 * three F1/F3/other failure buckets, spans two runIds (so the filter has
 * something to reject), and includes non-RETRY_FAILED entries so runTrace
 * has real ordering to verify.
 */
async function seedDiagnosticsFixture(ctx: AppContext) {
  const iso = (offsetSec: number) =>
    new Date(Date.parse('2026-04-01T10:00:00.000Z') + offsetSec * 1000).toISOString();

  const rows: ActivityLog[] = [
    // ── RUN_ID entries in chronological order ─────────────────────────
    {
      id: 'act_1',
      opportunityId: null,
      eventType: 'SCAN_STARTED',
      message: 'Scan started',
      metadata: { runId: RUN_ID, trigger: 'scheduled' },
      createdAt: iso(0),
    },
    {
      id: 'act_2',
      opportunityId: null,
      eventType: 'SOURCE_DISCOVERED',
      message: '8 source(s) discovered',
      metadata: { runId: RUN_ID, count: 8 },
      createdAt: iso(1),
    },
    // F1 × 3 — per-source failures carry sourceUrl in metadata
    {
      id: 'act_3',
      opportunityId: null,
      eventType: 'RETRY_FAILED',
      message: 'Source processing failed (https://a.example): boom',
      metadata: { runId: RUN_ID, sourceUrl: 'https://a.example' },
      createdAt: iso(2),
    },
    {
      id: 'act_4',
      opportunityId: null,
      eventType: 'RETRY_FAILED',
      message: 'Source processing failed (https://b.example): boom',
      metadata: { runId: RUN_ID, sourceUrl: 'https://b.example' },
      createdAt: iso(3),
    },
    {
      id: 'act_5',
      opportunityId: null,
      eventType: 'RETRY_FAILED',
      message: 'Source processing failed (https://c.example): boom',
      metadata: { runId: RUN_ID, sourceUrl: 'https://c.example' },
      createdAt: iso(4),
    },
    // F3 × 2 — action dispatch failures carry actionType
    {
      id: 'act_6',
      opportunityId: null,
      eventType: 'RETRY_FAILED',
      message: 'Action notify_stakeholder dispatch failed',
      metadata: { runId: RUN_ID, actionType: 'notify_stakeholder', attempts: 2 },
      createdAt: iso(5),
    },
    {
      id: 'act_7',
      opportunityId: null,
      eventType: 'RETRY_FAILED',
      message: 'Action create_dossier dispatch failed',
      metadata: { runId: RUN_ID, actionType: 'create_dossier', attempts: 2 },
      createdAt: iso(6),
    },
    // 'other' × 1 — RETRY_FAILED with neither sourceUrl nor actionType
    {
      id: 'act_8',
      opportunityId: null,
      eventType: 'RETRY_FAILED',
      message: 'Miscellaneous retry failure',
      metadata: { runId: RUN_ID, note: 'unclassified' },
      createdAt: iso(7),
    },
    {
      id: 'act_9',
      opportunityId: null,
      eventType: 'SCAN_COMPLETED',
      message: 'Scan finished',
      metadata: { runId: RUN_ID },
      createdAt: iso(8),
    },
    // ── OTHER_RUN_ID entries — must NOT appear in RUN_ID's diagnostics ──
    {
      id: 'act_10',
      opportunityId: null,
      eventType: 'RETRY_FAILED',
      message: 'Different run failure',
      metadata: { runId: OTHER_RUN_ID, sourceUrl: 'https://other.example' },
      createdAt: iso(9),
    },
    {
      id: 'act_11',
      opportunityId: null,
      eventType: 'SCAN_COMPLETED',
      message: 'Other scan finished',
      metadata: { runId: OTHER_RUN_ID },
      createdAt: iso(10),
    },
    // Row with metadata=null — must NOT match either runId filter
    {
      id: 'act_12',
      opportunityId: null,
      eventType: 'RETRY_STARTED',
      message: 'Metadata-less entry',
      metadata: null,
      createdAt: iso(11),
    },
  ];
  for (const row of rows) {
    await ctx.repos.activity.append(row);
  }

  // Minimal parent rows to satisfy action_queue FK on opportunity_id.
  const company: Company = {
    id: 'co_diag',
    name: 'Diag Co',
    website: null,
    address: null,
    city: null,
    latitude: null,
    longitude: null,
    sector: null,
    sourceUrls: [],
    createdAt: iso(15),
    updatedAt: iso(15),
  };
  await ctx.repos.companies.upsert(company);
  const opportunity: Opportunity = {
    id: 'op_1',
    companyId: company.id,
    signalIds: ['sig_placeholder'],
    status: 'promising',
    score: 50,
    confidence: 0.5,
    congestionContext: null,
    gridNeighborStatus: 'unknown',
    recommendedNextStep: null,
    createdAt: iso(16),
    updatedAt: iso(16),
  };
  await ctx.repos.opportunities.insert(opportunity);

  // action_queue: 2 pending, 1 dispatched, 1 failed — feeds actionQueueCounts.
  const queued: QueuedAction[] = [
    {
      id: 'q_1',
      opportunityId: 'op_1',
      actionType: 'notify_stakeholder',
      status: 'pending',
      attempts: 0,
      reason: 'r',
      metadata: null,
      lastError: null,
      createdAt: iso(20),
      updatedAt: iso(20),
      dispatchedAt: null,
    },
    {
      id: 'q_2',
      opportunityId: 'op_1',
      actionType: 'create_dossier',
      status: 'pending',
      attempts: 0,
      reason: 'r',
      metadata: null,
      lastError: null,
      createdAt: iso(21),
      updatedAt: iso(21),
      dispatchedAt: null,
    },
    {
      id: 'q_3',
      opportunityId: 'op_1',
      actionType: 'notify_stakeholder',
      status: 'dispatched',
      attempts: 1,
      reason: 'r',
      metadata: null,
      lastError: null,
      createdAt: iso(22),
      updatedAt: iso(22),
      dispatchedAt: iso(22),
    },
    {
      id: 'q_4',
      opportunityId: 'op_1',
      actionType: 'create_dossier',
      status: 'failed',
      attempts: 2,
      reason: 'r',
      metadata: null,
      lastError: 'boom',
      createdAt: iso(23),
      updatedAt: iso(23),
      dispatchedAt: null,
    },
  ];
  for (const q of queued) {
    await ctx.repos.actionQueue.enqueue(q);
  }
}

async function snapshotCounts(db: Db) {
  const [act, queue] = await Promise.all([
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM activity_log`),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM action_queue`),
  ]);
  return { activity: Number(act?.n ?? 0), queue: Number(queue?.n ?? 0) };
}

// ─── auth ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/run-diagnostics/:runId — auth', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('503 when no SERVICE_TOKEN is configured (endpoint functionally disabled)', async () => {
    const ctx = ctxWithToken(db, null);
    const app = createApp(ctx);
    const res = await app.request(`/api/admin/run-diagnostics/${RUN_ID}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('diagnostics_disabled');
  });

  it('401 when the X-Service-Token header is missing', async () => {
    const ctx = ctxWithToken(db, 'secret');
    const app = createApp(ctx);
    const res = await app.request(`/api/admin/run-diagnostics/${RUN_ID}`);
    expect(res.status).toBe(401);
  });

  it('401 when the X-Service-Token header is wrong', async () => {
    const ctx = ctxWithToken(db, 'secret');
    const app = createApp(ctx);
    const res = await app.request(`/api/admin/run-diagnostics/${RUN_ID}`, {
      headers: { 'x-service-token': 'nope' },
    });
    expect(res.status).toBe(401);
  });

  it('200 when the header matches', async () => {
    const ctx = ctxWithToken(db, 'secret');
    const app = createApp(ctx);
    const res = await app.request(`/api/admin/run-diagnostics/${RUN_ID}`, {
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(200);
  });
});

// ─── payload shape ────────────────────────────────────────────────────────

describe('GET /api/admin/run-diagnostics/:runId — payload', () => {
  let db: Db;
  beforeEach(async () => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  async function get(runId: string) {
    const ctx = ctxWithToken(db, 'secret');
    await seedDiagnosticsFixture(ctx);
    const app = createApp(ctx);
    const res = await app.request(`/api/admin/run-diagnostics/${runId}`, {
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      runId: string;
      failureSplit: Record<string, number>;
      failureDetails: Array<{ createdAt: string; message: string; metadata: unknown }>;
      runTrace: Array<{ createdAt: string; eventType: string; message: string; opportunityId: string | null }>;
      actionQueueCounts: Record<string, number>;
    };
  }

  it('failureSplit buckets RETRY_FAILED rows by metadata shape (F1 / F3 / other)', async () => {
    const body = await get(RUN_ID);
    expect(body.failureSplit).toEqual({
      F1_per_source: 3,
      F3_action_dispatch: 2,
      other: 1,
    });
  });

  it('failureDetails returns exactly the RETRY_FAILED rows for the requested runId, oldest first, with parsed metadata', async () => {
    const body = await get(RUN_ID);
    expect(body.failureDetails).toHaveLength(6); // 3 F1 + 2 F3 + 1 other
    // Oldest first — the fixture created them in monotonic order.
    const ts = body.failureDetails.map((r) => r.createdAt);
    expect(ts).toEqual([...ts].sort());
    // Metadata is parsed (object), not raw JSON string.
    for (const row of body.failureDetails) {
      expect(row.metadata).not.toBeNull();
      expect(typeof row.metadata).toBe('object');
      expect((row.metadata as { runId?: string }).runId).toBe(RUN_ID);
    }
    // Cross-run row (OTHER_RUN_ID) must be absent.
    expect(
      body.failureDetails.some((r) => (r.metadata as { runId?: string }).runId === OTHER_RUN_ID),
    ).toBe(false);
  });

  it('runTrace returns every activity row for the runId in chronological order', async () => {
    const body = await get(RUN_ID);
    // Fixture put 9 rows under RUN_ID (SCAN_STARTED, SOURCE_DISCOVERED,
    // 6 RETRY_FAILED, SCAN_COMPLETED).
    expect(body.runTrace.map((r) => r.eventType)).toEqual([
      'SCAN_STARTED',
      'SOURCE_DISCOVERED',
      'RETRY_FAILED',
      'RETRY_FAILED',
      'RETRY_FAILED',
      'RETRY_FAILED',
      'RETRY_FAILED',
      'RETRY_FAILED',
      'SCAN_COMPLETED',
    ]);
    // Chronological.
    const ts = body.runTrace.map((r) => r.createdAt);
    expect(ts).toEqual([...ts].sort());
    // Excludes OTHER_RUN_ID rows.
    expect(body.runTrace.some((r) => r.message.includes('Other scan'))).toBe(false);
    // Excludes rows with metadata=null.
    expect(body.runTrace.some((r) => r.message === 'Metadata-less entry')).toBe(false);
  });

  it('actionQueueCounts returns global status counts (not per-run)', async () => {
    const body = await get(RUN_ID);
    // Fixture seeds 2 pending, 1 dispatched, 1 failed.
    expect(body.actionQueueCounts).toEqual({
      pending: 2,
      dispatched: 1,
      failed: 1,
    });
  });

  it('unknown runId returns empty buckets, not a 404 (200 with zeros)', async () => {
    const body = await get('act_nonexistent');
    expect(body.failureSplit).toEqual({
      F1_per_source: 0,
      F3_action_dispatch: 0,
      other: 0,
    });
    expect(body.failureDetails).toEqual([]);
    expect(body.runTrace).toEqual([]);
    // Queue counts are global, so still present.
    expect(body.actionQueueCounts.pending).toBe(2);
  });

  it('is read-only — activity_log and action_queue row counts are unchanged after the call', async () => {
    const ctx = ctxWithToken(db, 'secret');
    await seedDiagnosticsFixture(ctx);
    const before = await snapshotCounts(db);
    const app = createApp(ctx);
    await app.request(`/api/admin/run-diagnostics/${RUN_ID}`, {
      headers: { 'x-service-token': 'secret' },
    });
    await app.request(`/api/admin/run-diagnostics/${RUN_ID}`, {
      headers: { 'x-service-token': 'secret' },
    });
    const after = await snapshotCounts(db);
    expect(after).toEqual(before);
  });
});
