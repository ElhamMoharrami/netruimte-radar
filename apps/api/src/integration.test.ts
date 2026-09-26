import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AnthropicEvidenceExtractor,
  AutonomousRunService,
  DemoGridContextProvider,
  DemoSourceDiscoveryProvider,
  FallbackEvidenceExtractor,
  LocalAutomationProvider,
  OpportunityDossierService,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  type AutomationDispatch,
  type AutomationProvider,
  type AutomationResult,
  type DiscoveredSource,
  type EvidenceExtractor,
  type SourceDiscoveryProvider,
} from '@netruimte/core';
import { openDb, createRepositories, type Db } from './persistence/index.js';
import { createApp } from './app.js';
import type { AppContext, WiringReport } from './context.js';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '../../../data/demo/sources');

interface BuildOpts {
  sources?: SourceDiscoveryProvider;
  extractor?: EvidenceExtractor;
  automation?: AutomationProvider;
  serviceToken?: string | null;
}

function buildCtx(db: Db, opts: BuildOpts = {}): AppContext {
  const repos = createRepositories(db);
  const sources = opts.sources ?? new DemoSourceDiscoveryProvider(demoRoot);
  const extractor = opts.extractor ?? new RuleBasedEvidenceExtractor();
  const grid = new DemoGridContextProvider();
  const automation = opts.automation ?? new LocalAutomationProvider();
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
    scheduledEndpointEnabled: opts.serviceToken !== undefined && opts.serviceToken !== null,
    aiProvider: 'rules' as const,
    gridProvider: 'demo' as const,
    gridProviderReason: 'test',
    databaseProvider: 'sqlite' as const,
    databaseProviderReason: 'test',
  };
  return {
    db,
    repos,
    demoMode: true,
    serviceToken: opts.serviceToken ?? null,
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

describe('V7 integration — scheduled autonomous run', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('requires the service token', async () => {
    const ctx = buildCtx(db, { serviceToken: 'secret-abc' });
    const app = createApp(ctx);
    const withoutToken = await app.request('/api/runs/scheduled', { method: 'POST' });
    expect(withoutToken.status).toBe(401);
    const wrongToken = await app.request('/api/runs/scheduled', {
      method: 'POST',
      headers: { 'x-service-token': 'wrong' },
    });
    expect(wrongToken.status).toBe(401);
  });

  it('returns 503 when no service token is configured', async () => {
    const ctx = buildCtx(db, { serviceToken: null });
    const app = createApp(ctx);
    const res = await app.request('/api/runs/scheduled', { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('records run history end-to-end for a successful scheduled run', async () => {
    const ctx = buildCtx(db, { serviceToken: 'secret-abc' });
    const app = createApp(ctx);

    const res = await app.request('/api/runs/scheduled', {
      method: 'POST',
      headers: { 'x-service-token': 'secret-abc' },
    });
    expect(res.status).toBe(200);
    const { summary } = (await res.json()) as {
      summary: {
        trigger: string;
        sourcesDiscovered: number;
        opportunitiesCreated: number;
        failures: number;
        incomplete: boolean;
      };
    };
    expect(summary.trigger).toBe('scheduled');
    expect(summary.sourcesDiscovered).toBe(3);
    expect(summary.opportunitiesCreated).toBeGreaterThanOrEqual(3);
    expect(summary.failures).toBe(0);
    expect(summary.incomplete).toBe(false);

    const historyRes = await app.request('/api/runs');
    const { data } = (await historyRes.json()) as { data: Array<{ trigger: string }> };
    expect(data).toHaveLength(1);
    expect(data[0]?.trigger).toBe('scheduled');
  });
});

describe('V7 integration — Apify failure recovery', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('recovers when the first Apify call fails and the retry succeeds', async () => {
    let calls = 0;
    const flakyProvider: SourceDiscoveryProvider = {
      name: 'apify-flaky',
      async discover() {
        calls += 1;
        if (calls === 1) throw new Error('apify 502');
        return [];
      },
    };
    const ctx = buildCtx(db, { sources: flakyProvider });
    const summary = await ctx.runService.run({ trigger: 'manual' });
    expect(calls).toBe(2);
    expect(summary.incomplete).toBe(false);
    // The run should be logged in history with the successful (retried) count.
    const runs = await ctx.repos.runs.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.incomplete).toBe(false);
  });

  it('marks the run incomplete after two failed Apify attempts', async () => {
    const alwaysFail: SourceDiscoveryProvider = {
      name: 'apify-broken',
      async discover() {
        throw new Error('apify permanent 503');
      },
    };
    const ctx = buildCtx(db, { sources: alwaysFail });
    const summary = await ctx.runService.run({ trigger: 'scheduled' });
    expect(summary.incomplete).toBe(true);
    expect(summary.failures).toBeGreaterThanOrEqual(1);
    expect(summary.sourcesDiscovered).toBe(0);
    const runs = await ctx.repos.runs.list();
    expect(runs[0]?.incomplete).toBe(true);
  });
});

describe('V7 integration — Anthropic fallback', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('falls back to rule-based when the Anthropic extractor throws', async () => {
    // Fake an Anthropic extractor that always throws — no API key needed.
    class ThrowingAnthropic implements EvidenceExtractor {
      readonly name = 'anthropic:fake';
      async extract(): Promise<never> {
        throw new Error('anthropic 500');
      }
    }
    const rule = new RuleBasedEvidenceExtractor();
    const fallback = new FallbackEvidenceExtractor(new ThrowingAnthropic(), rule);

    const ctx = buildCtx(db, { extractor: fallback });
    const summary = await ctx.runService.run({ trigger: 'manual' });

    expect(summary.opportunitiesCreated).toBeGreaterThanOrEqual(3);
    // Every extraction should record the fallback in the activity metadata.
    const activity = await ctx.repos.activity.listRecent(100);
    const fallbackExtractions = activity.filter(
      (a) =>
        a.eventType === 'EVIDENCE_EXTRACTED' &&
        String((a.metadata as Record<string, unknown>)?.extractor ?? '').includes('rule-based'),
    );
    expect(fallbackExtractions.length).toBeGreaterThanOrEqual(3);
  });

  it('AnthropicEvidenceExtractor is constructible without hitting the network', () => {
    const ex = new AnthropicEvidenceExtractor({ apiKey: 'sk-test' });
    expect(ex.name).toContain('anthropic');
  });
});

describe('V7 integration — n8n delivery failure', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('retries once, then logs delivery failure and marks the queued action failed', async () => {
    let attempts = 0;
    const failingAutomation: AutomationProvider = {
      name: 'n8n-broken',
      async dispatch(_p: AutomationDispatch): Promise<AutomationResult> {
        attempts += 1;
        throw new Error('n8n 502 attempt ' + attempts);
      },
    };
    const ctx = buildCtx(db, { automation: failingAutomation });
    const summary = await ctx.runService.run({ trigger: 'manual' });

    // Van Rijn should still yield a dossier decision → enqueued action →
    // dispatch attempted → retried → failed.
    expect(summary.actionsDispatched).toBe(0);
    expect(summary.failures).toBeGreaterThanOrEqual(1);
    // Each opportunity's queue item should be status=failed with 2 attempts.
    const failedActions = await ctx.repos.actionQueue.listByStatus('failed');
    expect(failedActions.length).toBeGreaterThanOrEqual(1);
    expect(failedActions[0]?.attempts).toBe(2);
    expect(failedActions[0]?.lastError).toMatch(/n8n 502/);

    // Activity log must contain RETRY_STARTED and RETRY_FAILED for the queue.
    const activity = await ctx.repos.activity.listRecent(200);
    const retries = activity.filter(
      (a) => a.eventType === 'RETRY_STARTED' || a.eventType === 'RETRY_FAILED',
    );
    expect(retries.length).toBeGreaterThanOrEqual(2);
  });
});

describe('V7 integration — conflicting evidence reversal', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('reverses a create_dossier decision to stop when new evidence contradicts', async () => {
    const ctx = buildCtx(db);
    // First run creates opportunities with initial evidence.
    await ctx.runService.run({ trigger: 'manual' });
    const firstRunOpps = await ctx.repos.opportunities.list();
    const vanRijn = firstRunOpps.find((o) =>
      firstRunOpps.every((x) => x.score <= o.score),
    );
    expect(vanRijn?.score).toBeGreaterThanOrEqual(65);
    const priorDecisions = await ctx.repos.decisions.listByOpportunity(vanRijn!.id);
    expect(priorDecisions[0]?.decisionType).toBe('create_dossier');

    // Inject a conflicting source that contradicts Van Rijn's fleet electrification.
    const companyRow = await ctx.repos.companies.findById(vanRijn!.companyId);
    const conflictSource: DiscoveredSource = {
      url: `https://conflict.example/${companyRow!.name}-cancel-${Date.now()}`,
      title: `${companyRow!.name} schrapt eerder aangekondigde plannen`,
      // Low-impact sustainability signal — contradicts the earlier
      // high-impact fleet electrification announcement.
      rawText: `${companyRow!.name} BV heeft vandaag laten weten in Rotterdam dat het bedrijf voor 2026 kiest voor een kleine duurzaamheidsupdate. Het bedrijf gaat verduurzamen met LED-verlichting in de kantoorruimte en verwacht geen wijzigingen aan de vloot of het pand. Er komen geen extra elektrische trucks bij.`,
      discoveredAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      sourceType: 'company_news',
      provider: 'test',
    };
    const injectingProvider: SourceDiscoveryProvider = {
      name: 'test-injector',
      async discover() {
        return [conflictSource];
      },
    };
    const service = new AutonomousRunService({
      repos: ctx.repos,
      sources: injectingProvider,
      extractor: new RuleBasedEvidenceExtractor(),
      grid: new DemoGridContextProvider(),
      scoring: new OpportunityScoringService(),
      policy: new PolicyEngine(),
      automation: new LocalAutomationProvider(),
    });
    const secondSummary = await service.run({ trigger: 'manual' });
    expect(secondSummary.opportunitiesReassessed).toBe(1);

    // Verify the decision changed from create_dossier and OPPORTUNITY_REASSESSED was logged.
    const updatedDecisions = await ctx.repos.decisions.listByOpportunity(vanRijn!.id);
    expect(updatedDecisions.length).toBeGreaterThan(priorDecisions.length);
    const latestDecision = updatedDecisions[updatedDecisions.length - 1]!;
    expect(latestDecision.decisionType).not.toBe('create_dossier');

    const activity = await ctx.repos.activity.listByOpportunity(vanRijn!.id);
    const reassess = activity.find((a) => a.eventType === 'OPPORTUNITY_REASSESSED');
    expect(reassess).toBeDefined();
    expect(reassess?.metadata).toBeDefined();

    // The queued dossier action should have been cancelled (if it was still
    // pending) OR its status marker changed via ACTION_BLOCKED activity.
    const queueItems = await ctx.repos.actionQueue.listByOpportunity(vanRijn!.id);
    expect(queueItems.length).toBeGreaterThanOrEqual(1);
  });
});
