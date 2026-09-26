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
 *     N8N_WEBHOOK_TOKEN, TURSO_AUTH_TOKEN, …) are read exclusively via
 *     `process.env` inside this function process at cold start.
 *   - Nothing here is exported to the frontend bundle; Vite only exposes
 *     `VITE_*` prefixed variables, and none exist in this project.
 *
 * State:
 *   - When `DATABASE_PROVIDER=turso` (with `TURSO_DATABASE_URL` +
 *     `TURSO_AUTH_TOKEN`), all persistence targets the shared libSQL
 *     database, so cold-started function instances observe the same rows
 *     that were written by earlier invocations. This is the required
 *     production configuration on Netlify — every scan writes to Turso,
 *     every dashboard read fetches from Turso.
 *   - Falling back to node:sqlite uses each Lambda's own in-memory DB and
 *     is only appropriate for local `netlify dev`.
 *
 * Lazy init:
 *   - Context creation is async (libsql schema init). We build it lazily on
 *     the first request and cache the Promise so warm invocations skip the
 *     handshake. A failed init rethrows on the *next* request too so any
 *     misconfiguration surfaces immediately.
 */
import { createApp, type App } from '../../apps/api/src/app.js';
import { createContext } from '../../apps/api/src/context.js';

let appP: Promise<App> | null = null;

async function getApp(): Promise<App> {
  if (!appP) {
    appP = (async () => {
      const ctx = await createContext();
      const app = createApp(ctx);
      app.get('/api/health', (c) =>
        c.json({
          status: 'ok',
          service: 'netruimte-radar-api',
          demoMode: ctx.demoMode,
          databaseProvider: ctx.wiring.databaseProvider,
          time: new Date().toISOString(),
        }),
      );
      return app;
    })().catch((err) => {
      // Reset so the next request re-attempts init — otherwise a transient
      // libsql handshake failure would poison the container permanently.
      appP = null;
      throw err;
    });
  }
  return appP;
}

export default async (request: Request) => (await getApp()).fetch(request);

export const config = {
  path: '/api/*',
};
