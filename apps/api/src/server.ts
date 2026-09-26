import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createContext } from './context.js';

const port = Number(process.env.API_PORT ?? 8787);
const hostname = process.env.API_HOST ?? '127.0.0.1';

const ctx = createContext();
const app = createApp(ctx);

serve({ fetch: app.fetch, port, hostname }, (info) => {
  // eslint-disable-next-line no-console
  console.log(
    `[netruimte-radar-api] listening on http://${info.address}:${info.port} (demoMode=${ctx.demoMode})`,
  );
});
