import { Hono } from 'hono';
import type { AppContext } from '../context.js';
import type { RunTrigger } from '@netruimte/shared';

export function runsRoutes(ctx: AppContext) {
  const app = new Hono();

  /**
   * POST /api/runs/demo
   * Endpoint the live UI's "Trigger autonomous scan" button hits. No auth.
   * The endpoint name is legacy — attribution is:
   *   ?offline=true → 'offline' (offline fixture provider)
   *   otherwise     → 'manual'  (operator-triggered live scan against the
   *                              wired production providers)
   * "demo" attribution is reserved for the explicit /api/demo/* endpoints.
   */
  app.post('/runs/demo', async (c) => {
    const offline = c.req.query('offline') === 'true';
    const service = offline ? ctx.buildOfflineRunService() : ctx.runService;
    const trigger: RunTrigger = offline ? 'offline' : 'manual';
    const summary = await service.run({ trigger, notes: offline ? 'offline mode' : undefined });
    return c.json({ wiring: ctx.wiring, summary });
  });

  /**
   * POST /api/runs/scheduled
   * Service-triggered (n8n cron, GitHub Actions, external scheduler).
   * Requires `X-Service-Token: <SERVICE_TOKEN>`. Returns 401 if the token is
   * missing/mismatched, or 503 if the API is not configured with any token.
   *
   * Attribution:
   *   ?offline=true → 'offline' (proves the pipeline still works end-to-end
   *                              without live upstreams)
   *   otherwise     → 'scheduled'
   */
  app.post('/runs/scheduled', async (c) => {
    if (!ctx.serviceToken) {
      return c.json({ error: 'scheduled_endpoint_disabled' }, 503);
    }
    const provided = c.req.header('x-service-token');
    if (provided !== ctx.serviceToken) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const offline = c.req.query('offline') === 'true';
    const service = offline ? ctx.buildOfflineRunService() : ctx.runService;
    const trigger: RunTrigger = offline ? 'offline' : 'scheduled';
    const summary = await service.run({ trigger, notes: offline ? 'offline mode' : undefined });
    return c.json({ wiring: ctx.wiring, summary });
  });

  /**
   * GET /api/runs
   * Persisted run history (most recent first). Never gated on the service
   * token — this is for operator visibility.
   */
  app.get('/runs', async (c) => {
    const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? 100)));
    const data = await ctx.repos.runs.list(limit);
    return c.json({ data });
  });

  app.get('/wiring', (c) => c.json(ctx.wiring));

  return app;
}
