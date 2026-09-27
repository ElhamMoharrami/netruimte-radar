/**
 * Tests for the TEMPORARY POST /api/admin/n8n-smoke-test endpoint.
 *
 * Delete alongside `routes/adminN8nSmokeTest.ts` after production dispatch
 * is confirmed working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DemoGridContextProvider,
  DemoSourceDiscoveryProvider,
  DisabledAutomationProvider,
  LocalAutomationProvider,
  N8nAutomationClient,
  OpportunityDossierService,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  AutonomousRunService,
  type AutomationProvider,
} from '@netruimte/core';
import { openDb, createRepositories, type Db } from '../persistence/index.js';
import { createApp } from '../app.js';
import type { AppContext, WiringReport } from '../context.js';

function makeCtx(db: Db, opts: { serviceToken: string | null; automation: AutomationProvider }): AppContext {
  const repos = createRepositories(db);
  const sources = new DemoSourceDiscoveryProvider('/dev/null');
  const extractor = new RuleBasedEvidenceExtractor();
  const grid = new DemoGridContextProvider();
  const runService = new AutonomousRunService({
    repos,
    sources,
    extractor,
    grid,
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation: opts.automation,
  });
  const dossierService = new OpportunityDossierService(repos);
  const wiring: WiringReport = {
    demoMode: false,
    extractor: extractor.name,
    extractorReason: 'test',
    sourceProvider: sources.name,
    sourceProviderReason: 'test',
    automationProvider: opts.automation.name,
    automationProviderReason: 'test',
    notificationAllowlist: 0,
    scheduledEndpointEnabled: Boolean(opts.serviceToken),
    aiProvider: 'rules',
    gridProvider: 'demo',
    gridProviderReason: 'test',
    databaseProvider: 'sqlite',
    databaseProviderReason: 'test',
    automationWebhookConfigured: opts.automation.name === 'n8n',
    automationWebhookHost: null,
    automationWebhookPath: null,
  };
  return {
    db,
    repos,
    demoMode: false,
    serviceToken: opts.serviceToken,
    sources,
    extractor,
    grid,
    automation: opts.automation,
    runService,
    dossierService,
    wiring,
    buildOfflineRunService: () => runService,
    resetDb: async () => undefined,
  };
}

async function tableCounts(db: Db) {
  const rows = await Promise.all([
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities`),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM companies`),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM evidence`),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM action_queue`),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM activity_log`),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM run_history`),
  ]);
  return {
    opportunities: Number(rows[0]?.n ?? 0),
    companies: Number(rows[1]?.n ?? 0),
    evidence: Number(rows[2]?.n ?? 0),
    action_queue: Number(rows[3]?.n ?? 0),
    activity_log: Number(rows[4]?.n ?? 0),
    run_history: Number(rows[5]?.n ?? 0),
  };
}

// ─── auth guards ──────────────────────────────────────────────────────────

describe('POST /api/admin/n8n-smoke-test — auth', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('503 when SERVICE_TOKEN is not configured', async () => {
    const ctx = makeCtx(db, { serviceToken: null, automation: new DisabledAutomationProvider() });
    const app = createApp(ctx);
    const res = await app.request('/api/admin/n8n-smoke-test', { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('401 when the X-Service-Token header is missing', async () => {
    const ctx = makeCtx(db, {
      serviceToken: 'secret',
      automation: new DisabledAutomationProvider(),
    });
    const app = createApp(ctx);
    const res = await app.request('/api/admin/n8n-smoke-test', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('401 when the X-Service-Token header is wrong', async () => {
    const ctx = makeCtx(db, {
      serviceToken: 'secret',
      automation: new DisabledAutomationProvider(),
    });
    const app = createApp(ctx);
    const res = await app.request('/api/admin/n8n-smoke-test', {
      method: 'POST',
      headers: { 'x-service-token': 'nope' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── refuses to run against a non-n8n provider ───────────────────────────

describe('POST /api/admin/n8n-smoke-test — provider gate', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('409 when the wired automation provider is not n8n (LocalAutomationProvider)', async () => {
    const ctx = makeCtx(db, {
      serviceToken: 'secret',
      automation: new LocalAutomationProvider(),
    });
    const app = createApp(ctx);
    const res = await app.request('/api/admin/n8n-smoke-test', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; provider: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.provider).toBe('local');
    expect(body.message).toMatch(/automation provider is "local"/);
    expect(body.message).toMatch(/N8N_ACTION_WEBHOOK_URL/);
  });
});

// ─── success + failure through the real N8nAutomationClient ──────────────

describe('POST /api/admin/n8n-smoke-test — dispatch', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('2xx response → { ok: true, provider: "n8n", status: 200 } and posts the synthetic opportunity to the webhook', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const n8n = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      webhookToken: 'super-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeCtx(db, { serviceToken: 'secret', automation: n8n });
    const app = createApp(ctx);
    const res = await app.request('/api/admin/n8n-smoke-test', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; provider: string; status: number; message: string };
    expect(body).toEqual({
      ok: true,
      provider: 'n8n',
      status: 200,
      message: 'n8n accepted the synthetic dispatch',
    });

    // Verify the synthetic opportunity id was actually sent, and no secret
    // leaked into the response body.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://foo.app.n8n.cloud/webhook/actions');
    const posted = JSON.parse((init as RequestInit).body as string) as {
      actionType: string;
      opportunityId: string;
      companyId: string;
    };
    expect(posted.actionType).toBe('create_dossier');
    expect(posted.opportunityId).toBe('op_hackathon_test');
    expect(posted.companyId).toBe('co_hackathon_test');
    // Response body must not contain the webhook URL, host, or token.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toContain('foo.app.n8n.cloud');
    expect(raw).not.toContain('/webhook/');
  });

  it('404 response → { ok: false, provider: "n8n", status: 404, message: "…n8n webhook failed…" } (unswallowed)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const n8n = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/broken',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeCtx(db, { serviceToken: 'secret', automation: n8n });
    const app = createApp(ctx);
    const res = await app.request('/api/admin/n8n-smoke-test', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    // 200 with ok:false — the endpoint worked, the downstream didn't.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; provider: string; status: number; message: string };
    expect(body.ok).toBe(false);
    expect(body.provider).toBe('n8n');
    expect(body.status).toBe(404);
    expect(body.message).toMatch(/n8n webhook failed: 404 Not Found/);
  });

  it('is a no-op on persistence — table counts unchanged before/after (success path)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const n8n = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeCtx(db, { serviceToken: 'secret', automation: n8n });
    const app = createApp(ctx);

    const before = await tableCounts(db);
    await app.request('/api/admin/n8n-smoke-test', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    const after = await tableCounts(db);
    expect(after).toEqual(before);
  });

  it('is a no-op on persistence — table counts unchanged after a downstream failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('boom', { status: 502, statusText: 'Bad Gateway' }),
    );
    const n8n = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/actions',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeCtx(db, { serviceToken: 'secret', automation: n8n });
    const app = createApp(ctx);

    const before = await tableCounts(db);
    await app.request('/api/admin/n8n-smoke-test', {
      method: 'POST',
      headers: { 'x-service-token': 'secret' },
    });
    const after = await tableCounts(db);
    expect(after).toEqual(before);
  });
});
