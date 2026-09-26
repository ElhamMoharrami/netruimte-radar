import type {
  CongestionContext,
  DecisionType,
  GridNeighborStatus,
  ImpactClass,
  OpportunityStatus,
  SignalType,
} from '@netruimte/shared';
import type { ScoringResult } from '../scoring/types.js';

export interface PolicyInput {
  signalType: SignalType;
  estimatedImpactClass: ImpactClass;
  extractionConfidence: number;
  scoring: ScoringResult;
  congestion: CongestionContext | null;
  gridNeighborStatus: GridNeighborStatus;
  existingStatus: OpportunityStatus | null;
  /**
   * Global feature flags — DEFAULT ALL OFF. Enables actions the system is
   * otherwise forbidden from taking (see rules in `policyEngine.ts`).
   */
  flags?: PolicyFlags;
}

export interface PolicyFlags {
  /** Allow the system to auto-contact the discovered business. Off by default. */
  allowAutomatedOutreach?: boolean;
  /** Allow claims about energy-hub feasibility. Off by default. */
  allowEnergyHubClaims?: boolean;
  /** Allow claims that companies share grid infrastructure. Off by default. */
  allowSharedGridClaims?: boolean;
}

export interface PolicyDecision {
  decision: DecisionType;
  reason: string;
  rulesTriggered: string[];
  timestamp: string;
  policyVersion: string;
  /** Suggested next opportunity status. */
  nextStatus: OpportunityStatus;
  /** Free-form next step for the operator/dashboard. */
  recommendedNextStep: string;
}
