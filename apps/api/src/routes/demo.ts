import { Hono } from 'hono';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  DemoSourceDiscoveryProvider,
  LocalAutomationProvider,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  type DiscoveredSource,
  type SourceDiscoveryProvider,
  type AutomationProvider,
  type AutomationDispatch,
  type AutomationResult,
} from '@netruimte/core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AppContext } from '../context.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEMO_SOURCES_DIR = resolve(here, '../../../../data/demo/sources');

/**
 * All /api/demo/* routes are gated on DEMO_MODE=true. In production mode they
 * return 403 — we don't want a live deployment offering "simulate failure"
 * buttons.
 *
 * The guard is scoped to `/demo/*` (not `*`) because this sub-app is mounted
 * with `app.route('/api', demoRoutes(ctx))`, which would otherwise turn a
 * wildcard middleware into an `/api/*` gate that shadows sibling read routes
 * mounted after it (e.g. `/api/grid-events`).
 */
export function demoRoutes(ctx: AppContext) {
  const app = new Hono();

  app.use('/demo/*', async (c, next) => {
    if (!ctx.demoMode) return c.json({ error: 'demo_disabled' }, 403);
    await next();
  });

  /**
   * POST /api/demo/reset
   * Wipe every row from every table so the demo starts clean.
   */
  app.post('/demo/reset', async (c) => {
    await ctx.resetDb();
    return c.json({ ok: true });
  });

  /**
   * POST /api/demo/overnight-scan
   * Runs the full autonomous pipeline via the wired providers as an explicit
   * demo control (the reviewer clicks "simulate overnight scan"). Attribution
   * is 'demo' — real scheduled runs come from n8n hitting
   * POST /api/runs/scheduled, and mixing the two poisons the /runs history
   * used to answer "how did the cron do last night?".
   */
  app.post('/demo/overnight-scan', async (c) => {
    const summary = await ctx.runService.run({
      trigger: 'demo',
      notes: 'demo overnight scan',
    });
    return c.json({ wiring: ctx.wiring, summary });
  });

  /**
   * POST /api/demo/inject-conflict/:opportunityId
   * Feeds a single fabricated source into the pipeline that materially
   * contradicts previous evidence for that opportunity's company. Triggers
   * the reassessment path so the reviewer can watch a decision reversal in
   * real time.
   */
  app.post('/demo/inject-conflict/:opportunityId', async (c) => {
    const oppId = c.req.param('opportunityId');
    const opportunity = await ctx.repos.opportunities.findById(oppId);
    if (!opportunity) return c.json({ error: 'opportunity_not_found' }, 404);
    const company = await ctx.repos.companies.findById(opportunity.companyId);
    if (!company) return c.json({ error: 'company_not_found' }, 404);
    const name = company.name;
    const conflictingSource: DiscoveredSource = {
      url: `https://conflict.example/${encodeURIComponent(name)}-${Date.now()}`,
      title: `${name} schrapt eerder aangekondigde plannen`,
      rawText: `${name} BV heeft vandaag laten weten in ${company.city ?? 'Nederland'} dat het bedrijf voor 2026 kiest voor een kleine duurzaamheidsupdate. Het bedrijf gaat verduurzamen met LED-verlichting in de kantoorruimte en verwacht geen wijzigingen aan de vloot of het pand.`,
      discoveredAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      sourceType: 'company_news',
      provider: 'demo-conflict-injector',
    };
    const service = new AutonomousRunService({
      repos: ctx.repos,
      sources: singletonProvider('demo-conflict-injector', [conflictingSource]),
      extractor: new RuleBasedEvidenceExtractor(),
      grid: new DemoGridContextProvider(),
      scoring: new OpportunityScoringService(),
      policy: new PolicyEngine(),
      automation: new LocalAutomationProvider(),
    });
    const summary = await service.run({ trigger: 'demo', notes: `inject conflict for ${name}` });
    return c.json({ summary });
  });

  /**
   * POST /api/demo/simulate/apify-fail
   * Runs the pipeline with a source provider that always throws — proves the
   * bounded-retry + incomplete-collection path.
   */
  app.post('/demo/simulate/apify-fail', async (c) => {
    const failing: SourceDiscoveryProvider = {
      name: 'apify-fail-sim',
      async discover() {
        throw new Error('simulated Apify timeout');
      },
    };
    const service = new AutonomousRunService({
      repos: ctx.repos,
      sources: failing,
      extractor: new RuleBasedEvidenceExtractor(),
      grid: new DemoGridContextProvider(),
      scoring: new OpportunityScoringService(),
      policy: new PolicyEngine(),
      automation: new LocalAutomationProvider(),
    });
    const summary = await service.run({ trigger: 'demo', notes: 'simulate Apify failure' });
    return c.json({ summary });
  });

  /**
   * POST /api/demo/simulate/n8n-fail
   * Runs the pipeline with an automation provider that always throws — proves
   * the bounded-retry + delivery-failure log.
   */
  app.post('/demo/simulate/n8n-fail', async (c) => {
    const failingAutomation: AutomationProvider = {
      name: 'n8n-fail-sim',
      async dispatch(_p: AutomationDispatch): Promise<AutomationResult> {
        throw new Error('simulated n8n webhook 502');
      },
    };
    const service = new AutonomousRunService({
      repos: ctx.repos,
      sources: new DemoSourceDiscoveryProvider(DEMO_SOURCES_DIR),
      extractor: new RuleBasedEvidenceExtractor(),
      grid: new DemoGridContextProvider(),
      scoring: new OpportunityScoringService(),
      policy: new PolicyEngine(),
      automation: failingAutomation,
    });
    const summary = await service.run({ trigger: 'demo', notes: 'simulate n8n failure' });
    return c.json({ summary });
  });

  return app;
}

function singletonProvider(name: string, docs: DiscoveredSource[]): SourceDiscoveryProvider {
  return {
    name,
    async discover() {
      return docs;
    },
  };
}
