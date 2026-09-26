import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from './context.js';
import { activityRoutes, opportunitiesRoutes } from './routes/opportunities.js';
import { runsRoutes } from './routes/runs.js';
import { demoRoutes } from './routes/demo.js';
import { gridEventsRoutes } from './routes/gridEvents.js';

/**
 * Build the Hono app around an injected {@link AppContext}. The autonomous-run
 * route lands in Step 9. Same instance works on Node or Cloudflare Workers.
 */
export function createApp(ctx: AppContext) {
  const app = new Hono();

  app.use('*', cors());

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'netruimte-radar-api',
      demoMode: ctx.demoMode,
      time: new Date().toISOString(),
    }),
  );

  app.route('/api', opportunitiesRoutes(ctx));
  app.route('/api', activityRoutes(ctx));
  app.route('/api', runsRoutes(ctx));
  app.route('/api', demoRoutes(ctx));
  app.route('/api', gridEventsRoutes(ctx));

  return app;
}

export type App = ReturnType<typeof createApp>;
