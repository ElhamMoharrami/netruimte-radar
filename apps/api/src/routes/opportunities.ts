import { Hono } from 'hono';
import type { AppContext } from '../context.js';

/**
 * GET /api/opportunities                    → list
 * GET /api/opportunities/:id                → detail with company + signals + decisions
 * GET /api/opportunities/:id/activity       → append-only activity feed for that opportunity
 * GET /api/activity/recent                  → global recent-activity feed for the dashboard
 */
export function opportunitiesRoutes(ctx: AppContext) {
  const app = new Hono();

  app.get('/opportunities', async (c) => {
    const list = await ctx.repos.opportunities.list();
    return c.json({ data: list });
  });

  app.get('/opportunities/:id', async (c) => {
    const id = c.req.param('id');
    const opportunity = await ctx.repos.opportunities.findById(id);
    if (!opportunity) return c.json({ error: 'not_found' }, 404);
    const company = await ctx.repos.companies.findById(opportunity.companyId);
    const signals = await Promise.all(
      opportunity.signalIds.map((sid) => ctx.repos.signals.findById(sid)),
    );
    const evidence = await ctx.repos.evidence.listByCompany(opportunity.companyId);
    const decisions = await ctx.repos.decisions.listByOpportunity(opportunity.id);
    return c.json({
      opportunity,
      company,
      signals: signals.filter((s) => s !== null),
      evidence,
      decisions,
    });
  });

  app.get('/opportunities/:id/activity', async (c) => {
    const id = c.req.param('id');
    const opportunity = await ctx.repos.opportunities.findById(id);
    if (!opportunity) return c.json({ error: 'not_found' }, 404);
    const activity = await ctx.repos.activity.listByOpportunity(id);
    return c.json({ opportunityId: id, activity });
  });

  app.get('/opportunities/:id/dossier', async (c) => {
    const id = c.req.param('id');
    const opportunity = await ctx.repos.opportunities.findById(id);
    if (!opportunity) return c.json({ error: 'not_found' }, 404);
    const dossier = await ctx.dossierService.getForOpportunity(id);
    if (!dossier) return c.json({ error: 'dossier_unavailable' }, 404);
    return c.json({ dossier });
  });

  app.get('/opportunities/:id/history', async (c) => {
    const id = c.req.param('id');
    const opportunity = await ctx.repos.opportunities.findById(id);
    if (!opportunity) return c.json({ error: 'not_found' }, 404);
    const decisions = await ctx.repos.decisions.listByOpportunity(id);
    const activity = await ctx.repos.activity.listByOpportunity(id);
    const reassessments = activity
      .filter((a) => a.eventType === 'OPPORTUNITY_REASSESSED')
      .map((a) => ({
        at: a.createdAt,
        message: a.message,
        ...(a.metadata as Record<string, unknown> | null),
      }));
    return c.json({ opportunityId: id, decisions, reassessments });
  });

  return app;
}

export function activityRoutes(ctx: AppContext) {
  const app = new Hono();
  app.get('/activity/recent', async (c) => {
    const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? 100)));
    const activity = await ctx.repos.activity.listRecent(limit);
    return c.json({ data: activity });
  });
  return app;
}
