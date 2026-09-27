/**
 * N8nAutomationClient — production-bug regression tests.
 *
 * Root cause fixed here: the old client derived per-action paths from a
 * base URL, so every production dispatch hit a path that didn't exist and
 * n8n returned 404. The new contract is one explicit `webhookUrl` used
 * verbatim for every action type, with routing inside the n8n workflow.
 */
import { describe, expect, it, vi } from 'vitest';
import { N8nAutomationClient } from './n8nClient.js';
import type { AutomationDispatch } from './types.js';
import type { Opportunity } from '@netruimte/shared';

const OPP: Opportunity = {
  id: 'op_1',
  companyId: 'co_1',
  signalIds: ['sig_1'],
  status: 'promising',
  score: 84,
  confidence: 0.8,
  congestionContext: null,
  gridNeighborStatus: 'unknown',
  recommendedNextStep: null,
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
};

function dispatch(actionType: AutomationDispatch['actionType']): AutomationDispatch {
  return {
    actionType,
    opportunity: OPP,
    reason: 'test',
    metadata: {},
  };
}

const WEBHOOK = 'https://foo.app.n8n.cloud/webhook/netruimte-radar-actions';

describe('N8nAutomationClient — URL + auth', () => {
  it('POSTs to the configured webhookUrl VERBATIM (no per-action path derivation)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = new N8nAutomationClient({
      webhookUrl: WEBHOOK,
      notificationAllowlist: ['ops@example.com'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.dispatch(dispatch('create_dossier'));
    await client.dispatch(dispatch('notify_stakeholder'));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // First arg is the URL — must be the exact string we configured, for
    // BOTH action types (the workflow routes by body.actionType).
    expect(fetchImpl.mock.calls[0]![0]).toBe(WEBHOOK);
    expect(fetchImpl.mock.calls[1]![0]).toBe(WEBHOOK);
  });

  it('sends the token in the x-n8n-token header, NEVER in the URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = new N8nAutomationClient({
      webhookUrl: WEBHOOK,
      webhookToken: 'super-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.dispatch(dispatch('create_dossier'));

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(WEBHOOK);
    expect(url as string).not.toContain('super-secret');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-n8n-token']).toBe('super-secret');
  });

  it('rejects non-http(s) schemes at construction', () => {
    expect(() => new N8nAutomationClient({ webhookUrl: 'file:///etc/passwd' })).toThrow(
      /must be http/,
    );
  });

  it('rejects a malformed URL at construction', () => {
    expect(() => new N8nAutomationClient({ webhookUrl: 'not a url' })).toThrow(/not a valid URL/);
  });

  it('exposes host + pathname via webhookSummary (no query, no token)', () => {
    const client = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/x?secret=abc',
      webhookToken: 'nope',
    });
    expect(client.webhookSummary()).toEqual({
      host: 'foo.app.n8n.cloud',
      pathname: '/webhook/x',
    });
  });
});

describe('N8nAutomationClient — response handling', () => {
  it('2xx → { dispatched: true } with safe URL label (host + path only)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const client = new N8nAutomationClient({
      webhookUrl: WEBHOOK,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.dispatch(dispatch('create_dossier'));
    expect(result.dispatched).toBe(true);
    expect(result.info).toBe(`POST foo.app.n8n.cloud/webhook/netruimte-radar-actions → 200`);
    // info must NOT contain the full URL (which could include a query in
    // future) or any token material.
    expect(result.info).not.toContain('https://');
  });

  it('404 → throws with explicit "n8n webhook failed" + status + safe URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('not found', { status: 404, statusText: 'Not Found' }));
    const client = new N8nAutomationClient({
      webhookUrl: 'https://foo.app.n8n.cloud/webhook/broken?token=leaked',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.dispatch(dispatch('create_dossier'))).rejects.toThrow(
      /n8n webhook failed: 404 Not Found \(POST foo\.app\.n8n\.cloud\/webhook\/broken\)/,
    );
    // Verify the thrown message never leaks the query-string secret.
    try {
      await client.dispatch(dispatch('create_dossier'));
    } catch (e) {
      expect((e as Error).message).not.toContain('leaked');
      expect((e as Error).message).not.toContain('token=');
    }
  });

  it('5xx → throws with explicit status (not swallowed)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('boom', { status: 502, statusText: 'Bad Gateway' }));
    const client = new N8nAutomationClient({
      webhookUrl: WEBHOOK,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.dispatch(dispatch('create_dossier'))).rejects.toThrow(
      /n8n webhook failed: 502 Bad Gateway/,
    );
  });
});

describe('N8nAutomationClient — allowlist safety', () => {
  it('notify_stakeholder with empty allowlist → { dispatched: false } (never calls fetch)', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new N8nAutomationClient({
      webhookUrl: WEBHOOK,
      notificationAllowlist: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.dispatch(dispatch('notify_stakeholder'));
    expect(result.dispatched).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('non-notify actions ignore the allowlist and dispatch normally', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const client = new N8nAutomationClient({
      webhookUrl: WEBHOOK,
      notificationAllowlist: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.dispatch(dispatch('create_dossier'));
    expect(result.dispatched).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
