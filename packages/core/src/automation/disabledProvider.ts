import type {
  AutomationDispatch,
  AutomationProvider,
  AutomationResult,
} from './types.js';

/**
 * Placeholder when neither n8n nor demo automation is configured in production
 * mode. Every dispatch returns `dispatched: false`, and the run engine logs
 * ACTION_BLOCKED — the operator sees the intended action in the log but
 * nothing is sent.
 */
export class DisabledAutomationProvider implements AutomationProvider {
  readonly name = 'disabled';

  async dispatch(_payload: AutomationDispatch): Promise<AutomationResult> {
    return {
      dispatched: false,
      provider: this.name,
      info: 'No automation provider configured; action logged only.',
    };
  }
}
