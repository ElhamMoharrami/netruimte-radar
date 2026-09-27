/**
 * Action-queue behavior — regression tests for the n8n 404 outage and the
 * stale-queue-drain that let failed actions repeatedly poison future runs.
 *
 * Guarantees exercised end-to-end via AutonomousRunService:
 *   - A failing dispatch retries at most once inside the same run (2 attempts total).
 *   - After the terminal failure, the row is `status='failed'` and is NOT
 *     re-attempted on subsequent runs (listByStatus('pending') never sees it).
 *   - Duplicate enqueue: a second scan producing the same
 *     (opportunityId, actionType) does NOT create a second pending row when
 *     an existing pending or failed row is present.
 *   - Historical failed rows are preserved (not deleted) for auditability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  N8nAutomationClient,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  type AutomationProvider,
  type DiscoveredSource,
  type SourceDiscoveryProvider,
} from '@netruimte/core';
import { openDb, createRepositories, type Db } from './persistence/index.js';

// A Van Rijn Logistics article that the rule-based extractor turns into a
// high-score signal → policy fires `create_dossier` → dispatchable action
// enqueued.
const VAN_RIJN_TEXT =
  'Van Rijn Logistics BV kondigt vandaag in Rotterdam aan dat het bedrijf 35 elektrische vrachtwagens in gebruik neemt. Daarmee vervangt Van Rijn 40% van zijn huidige dieselvloot.';

function vanRijnSource(url: string, text: string = VAN_RIJN_TEXT): DiscoveredSource {
  return {
    url,
    title: 'Van Rijn Logistics vernieuwt vloot',
    rawText: text,
    discoveredAt: new Date().toISOString(),
    publishedAt: null,
    sourceType: 'company_news',
    sourceClass: 'business_signal',
    provider: 'test',
  };
}

function stubSourceProvider(docs: DiscoveredSource[]): SourceDiscoveryProvider {
  return { name: 'test', async discover() { return docs; } };
}

function buildService(db: Db, provider: SourceDiscoveryProvider, automation: AutomationProvider) {
  const repos = createRepositories(db);
  return new AutonomousRunService({
    repos,
    sources: provider,
    extractor: new RuleBasedEvidenceExtractor(),
    grid: new DemoGridContextProvider(),
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation,
  });
}

// ─── dispatch behavior with real n8n client + stubbed fetch ─────────────

describe('action dispatch → n8n', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('2xx response → action marked dispatched, no failure counted, no retry', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const n8n = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const service = buildService(db, stubSourceProvider([vanRijnSource('https://x.example/a')]), n8n);
    const summary = await service.run({ trigger: 'manual' });

    expect(summary.actionsDispatched).toBeGreaterThanOrEqual(1);
    expect(summary.failures).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const repos = createRepositories(db);
    const q = await repos.actionQueue.listByOpportunity((await repos.opportunities.list())[0]!.id);
    expect(q.every((a) => a.status === 'dispatched')).toBe(true);
  });

  it('404 response → retry ONCE within the run, then status=failed, exactly one failure counted', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const n8n = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/broken',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const service = buildService(db, stubSourceProvider([vanRijnSource('https://x.example/a')]), n8n);
    const summary = await service.run({ trigger: 'manual' });

    // Exactly 2 fetch attempts (attempt=1 fails, attempt=2 fails), then give up.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(summary.actionsDispatched).toBe(0);
    // At least one failure — F3 for the dispatch.
    expect(summary.failures).toBeGreaterThanOrEqual(1);

    const repos = createRepositories(db);
    const opp = (await repos.opportunities.list())[0]!;
    const q = await repos.actionQueue.listByOpportunity(opp.id);
    expect(q).toHaveLength(1);
    expect(q[0]!.status).toBe('failed');
    expect(q[0]!.attempts).toBe(2);
    expect(q[0]!.lastError).toMatch(/n8n webhook failed: 404 Not Found/);

    // Failure activity carries the safe URL label (host + path only).
    const activity = await repos.activity.listRecent(500);
    const dispatchFailure = activity.find(
      (a) =>
        a.eventType === 'RETRY_FAILED' &&
        (a.metadata as { actionType?: string } | null)?.actionType != null,
    );
    expect(dispatchFailure).toBeTruthy();
    expect(dispatchFailure!.message).toContain('n8n webhook failed: 404');
    expect(dispatchFailure!.message).not.toContain('https://'); // no full URL leaked
  });
});

// ─── stale failed actions are NOT re-dispatched on the next scheduled run ─

describe('action queue draining across runs', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('a failed action from run #1 is NOT re-dispatched on run #2 (listByStatus("pending") excludes it)', async () => {
    // Scan #1: real business source, n8n returns 404 → action marked failed.
    const fetch1 = vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' }));
    const n8n1 = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      fetchImpl: fetch1 as unknown as typeof fetch,
    });
    await buildService(db, stubSourceProvider([vanRijnSource('https://x.example/a')]), n8n1).run({
      trigger: 'scheduled',
    });
    expect(fetch1).toHaveBeenCalledTimes(2); // 1 dispatch attempt + 1 retry
    const repos = createRepositories(db);
    let queue = await repos.actionQueue.listByStatus('failed');
    expect(queue).toHaveLength(1);

    // Scan #2: empty source list (nothing new to process). n8n is now
    // "healthy" (would return 200 if called) — the failed row must NOT be
    // retried. The healthy fetch must never fire.
    const fetch2 = vi.fn(async () => new Response('{}', { status: 200 }));
    const n8n2 = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      fetchImpl: fetch2 as unknown as typeof fetch,
    });
    const summary2 = await buildService(db, stubSourceProvider([]), n8n2).run({
      trigger: 'scheduled',
    });
    expect(fetch2, 'stale failed row must NOT be re-attempted').not.toHaveBeenCalled();
    expect(summary2.failures).toBe(0);
    expect(summary2.actionsDispatched).toBe(0);

    // Historical failed row is preserved (auditability).
    queue = await repos.actionQueue.listByStatus('failed');
    expect(queue).toHaveLength(1);
  });
});

// ─── duplicate enqueue suppression ───────────────────────────────────────

describe('duplicate action suppression on enqueue', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('a failed action for (opp, actionType) blocks a new enqueue on a later scan (no duplicate pending row)', async () => {
    // Scan #1: dispatch fails → status=failed.
    const fetch1 = vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' }));
    const n8n1 = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      fetchImpl: fetch1 as unknown as typeof fetch,
    });
    await buildService(db, stubSourceProvider([vanRijnSource('https://x.example/a')]), n8n1).run({
      trigger: 'scheduled',
    });

    const repos = createRepositories(db);
    const opp = (await repos.opportunities.list())[0]!;
    const qAfter1 = await repos.actionQueue.listByOpportunity(opp.id);
    expect(qAfter1).toHaveLength(1);
    expect(qAfter1[0]!.status).toBe('failed');

    // Scan #2: same URL but with CHANGED content so the policy re-fires
    // and would normally re-enqueue the same actionType. Suppression must
    // stop it — the failed row is the only queue entry for this opp.
    const updatedText =
      'Van Rijn Logistics BV in Rotterdam schaalt op: 60 elektrische vrachtwagens in gebruik.';
    const fetch2 = vi.fn(async () => new Response('{}', { status: 200 }));
    const n8n2 = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      fetchImpl: fetch2 as unknown as typeof fetch,
    });
    await buildService(
      db,
      stubSourceProvider([vanRijnSource('https://x.example/a', updatedText)]),
      n8n2,
    ).run({ trigger: 'scheduled' });

    const qAfter2 = await repos.actionQueue.listByOpportunity(opp.id);
    expect(qAfter2, 'no duplicate row for the same (opp, actionType)').toHaveLength(1);
    // n8n never called on scan #2 because the enqueue was suppressed.
    expect(fetch2).not.toHaveBeenCalled();

    // Duplicate-suppression is surfaced in the activity log so operators
    // can see why nothing was dispatched.
    const activity = await repos.activity.listRecent(500);
    const suppressed = activity.find(
      (a) =>
        a.eventType === 'ACTION_BLOCKED' &&
        (a.metadata as { reason?: string } | null)?.reason === 'duplicate_suppressed',
    );
    expect(suppressed).toBeTruthy();
  });
});
