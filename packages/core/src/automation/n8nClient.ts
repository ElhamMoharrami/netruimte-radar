import type {
  ActionType,
  AutomationDispatch,
  AutomationProvider,
  AutomationResult,
} from './types.js';

export interface N8nAutomationClientOptions {
  baseUrl: string;
  webhookToken?: string;
  /** Optional per-action webhook path override. Defaults to `/webhook/<actionType>`. */
  pathsByAction?: Partial<Record<ActionType, string>>;
  /**
   * Recipients allowed to receive notifications through this client. Enforced
   * in code — n8n workflows should also enforce it, but we do NOT trust that.
   * Empty array + notify_stakeholder = the client refuses to dispatch.
   */
  notificationAllowlist?: string[];
  /** Injected in tests to avoid real network. */
  fetchImpl?: typeof fetch;
}

const NOTIFY_ACTIONS: ActionType[] = ['notify_stakeholder'];

/**
 * Posts the autonomous action to an n8n webhook. Real HTTP client — no fake
 * fallback. If the POST fails the caller (AutonomousRunService) is responsible
 * for bounded retry / logging; this client throws on non-2xx so the outer
 * dispatcher can decide whether to retry.
 *
 * Safety invariants enforced in code:
 *   - `notify_stakeholder` actions REQUIRE at least one recipient in
 *     `notificationAllowlist`. Otherwise we return {dispatched: false, ...}
 *     with a clear reason — we never send unsolicited outreach to a scraped
 *     business.
 */
export class N8nAutomationClient implements AutomationProvider {
  readonly name = 'n8n';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: N8nAutomationClientOptions) {
    if (!opts.baseUrl) throw new Error('N8nAutomationClient requires baseUrl');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async dispatch(payload: AutomationDispatch): Promise<AutomationResult> {
    const allowlist = this.opts.notificationAllowlist ?? [];
    if (NOTIFY_ACTIONS.includes(payload.actionType) && allowlist.length === 0) {
      return {
        dispatched: false,
        provider: this.name,
        info: 'notification allowlist is empty; refusing to send unsolicited outreach',
      };
    }

    const path = this.opts.pathsByAction?.[payload.actionType] ?? `/webhook/${payload.actionType}`;
    const url = new URL(path, this.opts.baseUrl);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.webhookToken) {
      headers['x-n8n-token'] = this.opts.webhookToken;
    }
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        actionType: payload.actionType,
        opportunityId: payload.opportunity.id,
        companyId: payload.opportunity.companyId,
        score: payload.opportunity.score,
        reason: payload.reason,
        // Recipients are supplied by our allowlist, NEVER by the scraped
        // company or the LLM extraction.
        recipients: NOTIFY_ACTIONS.includes(payload.actionType) ? allowlist : [],
        metadata: payload.metadata ?? {},
        emittedAt: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      throw new Error(`n8n webhook failed: ${res.status} ${res.statusText}`);
    }
    return { dispatched: true, provider: this.name, info: `POST ${url.pathname} → ${res.status}` };
  }
}
