import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createContext } from './context.js';

describe('api/health', () => {
  it('returns ok', async () => {
    const ctx = await createContext({
      sqlitePath: ':memory:',
      demoMode: true,
    });
    const app = createApp(ctx);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      service: string;
      demoMode: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('netruimte-radar-api');
    expect(body.demoMode).toBe(true);
  });
});
