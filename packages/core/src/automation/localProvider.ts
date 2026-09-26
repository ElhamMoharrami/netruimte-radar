import type {
  AutomationDispatch,
  AutomationProvider,
  AutomationResult,
} from './types.js';

/**
 * Local-only automation provider — records the dispatch but does not perform
 * any real outbound call. Suitable ONLY for demo mode; using this in
 * production would silently swallow real actions.
 *
 * The run engine records ACTION_DISPATCHED (info: "local, demo mode") when
 * this fires, so the audit trail always makes it clear no real n8n call
 * happened.
 */
export class LocalAutomationProvider implements AutomationProvider {
  readonly name = 'local';
  readonly dispatched: AutomationDispatch[] = [];

  async dispatch(payload: AutomationDispatch): Promise<AutomationResult> {
    this.dispatched.push(payload);
    return {
      dispatched: true,
      provider: this.name,
      info: 'Recorded locally (demo mode — no external call made)',
    };
  }
}
