import { Hono } from 'hono';
import type { AppContext } from '../context.js';

export function gridEventsRoutes(ctx: AppContext) {
  const app = new Hono();

  /** GET /api/grid-events?limit=100 → most-recent first (max 500). */
  app.get('/grid-events', async (c) => {
    const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? 100)));
    const data = await ctx.repos.gridEvents.list(limit);
    return c.json({ data });
  });

  /** GET /api/grid-events/:id → single event with full metadata. */
  app.get('/grid-events/:id', async (c) => {
    const id = c.req.param('id');
    const event = await ctx.repos.gridEvents.findById(id);
    if (!event) return c.json({ error: 'not_found' }, 404);
    return c.json({ event });
  });

  return app;
}
