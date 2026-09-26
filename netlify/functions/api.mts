/**
 * Netlify Functions adapter for the Hono API.
 *
 * This file is the thinnest possible wrapper: it constructs the same
 * AppContext + Hono app that `apps/api/src/server.ts` builds locally, then
 * hands each incoming Request straight to Hono's native `app.fetch`.
 *
 * The application code itself is not modified — the only local addition here
 * is a `/api/health` alias, because the app currently exposes `/health` at
 * the root while the Netlify surface convention is that every route sits
 * under `/api/*`.
 *
 * Routing:
 *   - Netlify Functions v2 declarative routing via `config.path = '/api/*'`
 *     means Netlify catches every /api/* request and forwards it to this
 *     function WITHOUT stripping the prefix, so Hono sees the original path
 *     (/api/opportunities, /api/wiring, /api/runs/scheduled, …).
 *   - The SPA fallback rewrite in netlify.toml (`/*` → `/index.html`) runs
 *     AFTER function routing, so it never intercepts /api/*.
 *
 * Environment variables:
 *   - All server-side secrets (SERVICE_TOKEN, APIFY_TOKEN, *_API_KEY,
 *     N8N_WEBHOOK_TOKEN, …) are read exclusively via `process.env` inside
 *     this function process at cold start.
 *   - Nothing here is exported to the frontend bundle; Vite only exposes
 *     `VITE_*` prefixed variables, and none exist in this project.
 *
 * State:
 *   - The current AppContext uses `node:sqlite`. On Netlify Functions the
 *     filesystem outside `/tmp` is read-only, so `SQLITE_PATH` should be
 *     left unset (defaults to `:memory:`). This means each Lambda instance
 *     gets its own in-memory database. Warm invocations on the same
 *     instance share state; cold starts don't. This is acceptable for the
 *     hackathon demo — n8n POSTs a run and reads the summary from the
 *     same response — but is documented in README.
 */
import { createApp } from '../../apps/api/src/app.js';
import { createContext } from '../../apps/api/src/context.js';

const ctx = createContext();
const app = createApp(ctx);

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'netruimte-radar-api',
    demoMode: ctx.demoMode,
    time: new Date().toISOString(),
  }),
);

export default (request: Request) => app.fetch(request);

export const config = {
  path: '/api/*',
};
