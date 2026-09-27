import type {
  AutomationDispatch,
  AutomationProvider,
  AutomationResult,
  ActionType,
} from './types.js';

/**
 * n8n webhook dispatcher.
 *
 * ⚠️  Historical bug (fixed here): the previous version accepted a
 * `baseUrl` and appended `/webhook/<actionType>` per action. Two problems:
 *   1. n8n Cloud setups normally use ONE webhook per workflow that
 *      inspects `actionType` in the JSON body — separate webhooks per
 *      action type is not the standard shape.
 *   2. `new URL('/webhook/x', 'https://x.app.n8n.cloud/webhook/prod')`
 *      DROPS the base URL's path (URL's join semantics for absolute
 *      paths). So an operator who set the full webhook URL as
 *      `N8N_BASE_URL` still had it silently truncated.
 * Combined: every production dispatch hit a path that didn't exist and
 * n8n returned 404 for all of them.
 *
 * The dispatcher now takes ONE explicit `webhookUrl` and posts to it
 * verbatim. The n8n workflow is expected to read `actionType` from the
 * body to route internally.
 *
 * Auth: `webhookToken` (if set) is sent in the `x-n8n-token` header,
 * never in the URL. Logs and errors surface host + pathname only —
 * query strings + tokens are never echoed.
 *
 * Safety: `notify_stakeholder` still requires a non-empty allowlist.
 */

export interface N8nAutomationClientOptions {
  /**
   * The exact production webhook URL (single endpoint). Example:
   *   https://<workspace>.app.n8n.cloud/webhook/netruimte-radar-actions
   * Not derived from any base URL — pass the whole thing.
   */
  webhookUrl: string;
  /** Sent as `x-n8n-token` when present. NEVER placed in the URL. */
  webhookToken?: string;
  /**
   * Recipients allowed to receive notifications through this client.
   * Enforced in code; n8n workflows should also enforce it but we do
   * NOT trust them. Empty array + notify_stakeholder = refuses dispatch.
   */
  notificationAllowlist?: string[];
  /** Injected in tests to avoid real network. */
  fetchImpl?: typeof fetch;
}

const NOTIFY_ACTIONS: ActionType[] = ['notify_stakeholder'];

export class N8nAutomationClient implements AutomationProvider {
  readonly name = 'n8n';
  private readonly fetchImpl: typeof fetch;
  /** Parsed once at construction so error paths never re-throw on bad URL. */
  private readonly parsed: URL;

  constructor(private readonly opts: N8nAutomationClientOptions) {
    if (!opts.webhookUrl) {
      throw new Error('N8nAutomationClient requires webhookUrl');
    }
    try {
      this.parsed = new URL(opts.webhookUrl);
    } catch (err) {
      throw new Error(
        `N8nAutomationClient webhookUrl is not a valid URL: ${(err as Error).message}`,
      );
    }
    if (this.parsed.protocol !== 'https:' && this.parsed.protocol !== 'http:') {
      throw new Error(
        `N8nAutomationClient webhookUrl must be http(s), got ${this.parsed.protocol}`,
      );
    }
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Safe log/error string — host + pathname only, no query, no token. */
  private safeUrlLabel(): string {
    return `${this.parsed.host}${this.parsed.pathname}`;
  }

  /** For /api/wiring — exposed so ops can eyeball config without curl-ing n8n. */
  webhookSummary(): { host: string; pathname: string } {
    return { host: this.parsed.host, pathname: this.parsed.pathname };
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

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.webhookToken) {
      headers['x-n8n-token'] = this.opts.webhookToken;
    }
    const res = await this.fetchImpl(this.opts.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        actionType: payload.actionType,
        opportunityId: payload.opportunity.id,
        companyId: payload.opportunity.companyId,
        score: payload.opportunity.score,
        reason: payload.reason,
        // Recipients come from our allowlist — never from scraped data.
        recipients: NOTIFY_ACTIONS.includes(payload.actionType) ? allowlist : [],
        metadata: payload.metadata ?? {},
        emittedAt: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      // Explicit failure — status + statusText + safe URL label. Nothing
      // is swallowed; the outer dispatcher decides whether to retry.
      throw new Error(
        `n8n webhook failed: ${res.status} ${res.statusText} (POST ${this.safeUrlLabel()})`,
      );
    }
    return {
      dispatched: true,
      provider: this.name,
      info: `POST ${this.safeUrlLabel()} → ${res.status}`,
    };
  }
}
