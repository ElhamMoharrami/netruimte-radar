import type { Opportunity } from '@netruimte/shared';

export type ActionType =
  | 'create_dossier'
  | 'notify_stakeholder'
  | 'request_human_review'
  | 'request_grid_verification';

export interface AutomationDispatch {
  actionType: ActionType;
  opportunity: Opportunity;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationResult {
  dispatched: boolean;
  provider: string;
  info?: string;
}

/**
 * Any n8n-style webhook orchestrator implements this. The run engine calls
 * `dispatch()` after the PolicyEngine decides. If the provider isn't
 * configured, `dispatched=false` and we log ACTION_BLOCKED rather than
 * silently faking a successful send.
 */
export interface AutomationProvider {
  readonly name: string;
  dispatch(payload: AutomationDispatch): Promise<AutomationResult>;
}
