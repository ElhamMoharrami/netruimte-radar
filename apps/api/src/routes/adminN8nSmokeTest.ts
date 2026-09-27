/**
 * ⚠️  TEMPORARY one-shot n8n smoke test — remove immediately after the
 * dispatch is confirmed working in production.
 *
 * Purpose: dispatch exactly one synthetic `create_dossier` action through
 * the EXISTING production n8n client (`ctx.automation`) to confirm the
 * webhook URL / token wiring end-to-end from the actual Netlify Function
 * runtime. Nothing else — no scan, no persistence, no real opportunity.
 *
 * Safety invariants:
 *   - Auth: X-Service-Token gated, same shared secret as the scheduled run
 *     and diagnostics endpoints. 503 if no token configured; 401 on mismatch.
 *   - Reuses `ctx.automation` verbatim — same client instance, same env
 *     (N8N_ACTION_WEBHOOK_URL, N8N_WEBHOOK_TOKEN, notification allowlist)
 *     as the scheduled dispatcher. No second URL, no second secret.
 *   - Refuses to run when `automation.name !== 'n8n'` — a green result
 *     against LocalAutomationProvider would be false confidence.
 *   - Synthetic opportunity id `op_hackathon_test` + company id
 *     `co_hackathon_test`. NEVER touches an existing opportunity/company.
 *     No repo writes — no `opportunities.insert`, no `actionQueue.enqueue`,
 *     no `evidence.insert`. Only the outbound HTTP POST happens.
 *   - Response body echoes only `{ ok, provider, status, message }`. No
 *     URL, no host, no token, no query string — everything the operator
 *     needs to verify wiring is already in /api/wiring.
 *
 * When to remove: delete this file, the wire-up in `app.ts`, and its
 * test file (`adminN8nSmokeTest.test.ts`) as soon as one 200 comes back
 * from n8n.
 */
import { Hono } from 'hono';
import type { Opportunity } from '@netruimte/shared';
import type { AppContext } from '../context.js';

const SYNTHETIC_OPPORTUNITY: Opportunity = {
  id: 'op_hackathon_test',
  companyId: 'co_hackathon_test',
  signalIds: ['sig_hackathon_test'],
  status: 'promising',
  score: 84,
  confidence: 0.8,
  congestionContext: null,
  gridNeighborStatus: 'unknown',
  recommendedNextStep: null,
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
};

/**
 * Extract the HTTP status code out of the N8nAutomationClient's info/error
 * strings without echoing the full URL. The success info is
 *   "POST <host><path> → <status>"
 * and the failure message is
 *   "n8n webhook failed: <status> <statusText> (POST <host><path>)"
 * Returns null if we can't find a status token — the caller falls back to
 * the raw message shape.
 */
function extractStatus(text: string): number | null {
  const successMatch = text.match(/→\s*(\d{3})/);
  if (successMatch) return Number(successMatch[1]);
  const failMatch = text.match(/failed:\s*(\d{3})/);
  if (failMatch) return Number(failMatch[1]);
  return null;
}

export function adminN8nSmokeTestRoutes(ctx: AppContext) {
  const app = new Hono();

  app.post('/admin/n8n-smoke-test', async (c) => {
    if (!ctx.serviceToken) {
      return c.json({ ok: false, message: 'smoke_test_disabled_no_token' }, 503);
    }
    const provided = c.req.header('x-service-token');
    if (provided !== ctx.serviceToken) {
      return c.json({ ok: false, message: 'unauthorized' }, 401);
    }
    if (ctx.automation.name !== 'n8n') {
      // Refuse rather than fake-succeed against LocalAutomationProvider or
      // DisabledAutomationProvider — a passing test in that state would be
      // meaningless.
      return c.json(
        {
          ok: false,
          provider: ctx.automation.name,
          message: `automation provider is "${ctx.automation.name}" — set N8N_ACTION_WEBHOOK_URL to exercise this test`,
        },
        409,
      );
    }

    try {
      const result = await ctx.automation.dispatch({
        actionType: 'create_dossier',
        opportunity: SYNTHETIC_OPPORTUNITY,
        reason: 'hackathon smoke test — synthetic dispatch, not a real action',
        metadata: { synthetic: true, source: 'admin/n8n-smoke-test' },
      });
      const status = extractStatus(result.info ?? '');
      return c.json({
        ok: result.dispatched,
        provider: result.provider,
        status,
        message: result.dispatched
          ? 'n8n accepted the synthetic dispatch'
          : (result.info ?? 'provider declined dispatch'),
      });
    } catch (err) {
      const message = (err as Error).message;
      const status = extractStatus(message);
      return c.json(
        {
          ok: false,
          provider: 'n8n',
          status,
          message,
        },
        // 200 payload with ok:false is easier to read from curl than a
        // non-2xx — the endpoint itself worked, the downstream didn't.
        200,
      );
    }
  });

  return app;
}
