import { createHash } from 'node:crypto';
import {
  newId,
  nowIso,
  type Company,
  type DecisionType,
  type Evidence,
  type Opportunity,
  type QueuedAction,
  type Repositories,
  type RunHistory,
  type RunTrigger,
  type Signal,
} from '@netruimte/shared';
import { ActivityLogger } from '../activity/activityLogger.js';
import type { EvidenceExtractor, ExtractionResult } from '../extraction/types.js';
import type { GridUpdateExtractor } from '../extraction/gridUpdateExtractor.js';
import { RuleBasedGridUpdateExtractor } from '../extraction/gridUpdateExtractor.js';
import type { GridContextProvider } from '../grid/types.js';
import { PolicyEngine, type PolicyDecision } from '../policy/index.js';
import { OpportunityScoringService, type ScoringResult } from '../scoring/index.js';
import type { DiscoveredSource, SourceDiscoveryProvider } from '../sources/types.js';
import type { AutomationDispatch, AutomationProvider } from '../automation/types.js';
import { buildDossierContent, type DossierAdditionalContext } from '../dossier/dossierService.js';

export interface AutonomousRunDeps {
  repos: Repositories;
  sources: SourceDiscoveryProvider;
  extractor: EvidenceExtractor;
  /**
   * Optional dedicated extractor for `sourceClass: 'grid_update'` sources
   * (Liander / Enexis / Stedin capacity pages). Defaults to a rule-based
   * implementation. Independent of `grid` — the municipality-level
   * GridContextProvider is untouched.
   */
  gridUpdateExtractor?: GridUpdateExtractor;
  grid: GridContextProvider;
  scoring?: OpportunityScoringService;
  policy?: PolicyEngine;
  automation: AutomationProvider;
  /** Injected for reproducible tests. */
  now?: () => string;
}

export interface AutonomousRunOptions {
  trigger?: RunTrigger;
  /** Optional caller-supplied note stored on the RunHistory row. */
  notes?: string;
}

export interface AutonomousRunSummary {
  runId: string;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string;
  sourceProvider: string;
  extractor: string;
  automationProvider: string;
  sourcesDiscovered: number;
  companiesProcessed: number;
  signalsDetected: number;
  opportunitiesCreated: number;
  opportunitiesReassessed: number;
  /** Count of sourceClass=grid_update sources that were extracted this run. */
  gridUpdatesDetected: number;
  decisions: Record<DecisionType, number>;
  actionsDispatched: number;
  actionsBlocked: number;
  actionsCancelled: number;
  failures: number;
  incomplete: boolean;
  notes: string | null;
}

/**
 * End-to-end autonomous run:
 *   SCAN_STARTED → discover (with 1 bounded retry) →
 *     per source: extract → identify company → grid context → score →
 *     policy → persist opportunity + decision → enqueue action →
 *     (existing opportunity? reassess: same flow) → dispatch queue →
 *     RunHistory persisted → SCAN_COMPLETED.
 *
 * Every side effect is written to the activity log so the dashboard can
 * replay the run. A failure on one source doesn't kill the run — we log
 * RETRY_FAILED and continue with the next source.
 */
export class AutonomousRunService {
  private readonly logger: ActivityLogger;
  private readonly scoring: OpportunityScoringService;
  private readonly policy: PolicyEngine;
  private readonly gridUpdateExtractor: GridUpdateExtractor;
  private readonly now: () => string;

  constructor(private readonly deps: AutonomousRunDeps) {
    this.logger = new ActivityLogger(deps.repos.activity);
    this.scoring = deps.scoring ?? new OpportunityScoringService();
    this.policy = deps.policy ?? new PolicyEngine();
    this.gridUpdateExtractor = deps.gridUpdateExtractor ?? new RuleBasedGridUpdateExtractor();
    this.now = deps.now ?? nowIso;
  }

  async run(opts: AutonomousRunOptions = {}): Promise<AutonomousRunSummary> {
    const trigger: RunTrigger = opts.trigger ?? 'manual';
    const runId = newId.activity();
    const startedAt = this.now();
    const notes = opts.notes ?? null;

    await this.logger.log('SCAN_STARTED', {
      message: `Scan started (trigger=${trigger}, provider=${this.deps.sources.name}, extractor=${this.deps.extractor.name})`,
      metadata: { runId, trigger },
    });

    const summary: AutonomousRunSummary = {
      runId,
      trigger,
      startedAt,
      finishedAt: startedAt,
      sourceProvider: this.deps.sources.name,
      extractor: this.deps.extractor.name,
      automationProvider: this.deps.automation.name,
      sourcesDiscovered: 0,
      companiesProcessed: 0,
      signalsDetected: 0,
      opportunitiesCreated: 0,
      opportunitiesReassessed: 0,
      gridUpdatesDetected: 0,
      decisions: {
        continue_investigation: 0,
        stop: 0,
        request_human: 0,
        create_dossier: 0,
        notify_stakeholder: 0,
        request_grid_verification: 0,
      },
      actionsDispatched: 0,
      actionsBlocked: 0,
      actionsCancelled: 0,
      failures: 0,
      incomplete: false,
      notes,
    };

    // Source discovery with one bounded retry (V6).
    const sources = await this.discoverWithRetry(runId, summary);
    if (sources === null) {
      // Discovery failed permanently — persist history and exit.
      summary.finishedAt = this.now();
      await this.finalizeRun(summary);
      return summary;
    }

    for (const source of sources) {
      try {
        await this.processSource(source, runId, summary);
      } catch (err) {
        summary.failures += 1;
        await this.logger.log('RETRY_FAILED', {
          message: `Source processing failed (${source.url}): ${(err as Error).message}`,
          metadata: { runId, sourceUrl: source.url },
        });
      }
    }

    // Drain the action queue for any opportunities we touched this run.
    await this.drainActionQueue(runId, summary);

    summary.finishedAt = this.now();
    await this.finalizeRun(summary);
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Source discovery with one bounded retry
  // ---------------------------------------------------------------------------

  private async discoverWithRetry(
    runId: string,
    summary: AutonomousRunSummary,
  ): Promise<DiscoveredSource[] | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const sources = await this.deps.sources.discover();
        summary.sourcesDiscovered = sources.length;
        await this.logger.log('SOURCE_DISCOVERED', {
          message: `${sources.length} source(s) discovered${attempt > 1 ? ' (after retry)' : ''}`,
          metadata: { runId, count: sources.length, provider: this.deps.sources.name, attempt },
        });
        return sources;
      } catch (err) {
        if (attempt === 1) {
          await this.logger.log('RETRY_STARTED', {
            message: `Source discovery failed, retrying once: ${(err as Error).message}`,
            metadata: { runId, provider: this.deps.sources.name },
          });
        } else {
          summary.failures += 1;
          summary.incomplete = true;
          await this.logger.log('RETRY_FAILED', {
            message: `Source discovery failed after retry — collection incomplete: ${(err as Error).message}`,
            metadata: { runId, provider: this.deps.sources.name },
          });
          return null;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Per-source workflow (create OR reassess)
  // ---------------------------------------------------------------------------

  private async processSource(
    source: DiscoveredSource,
    runId: string,
    summary: AutonomousRunSummary,
  ): Promise<void> {
    // Route by sourceClass. `grid_update` sources go through a dedicated
    // extractor and are logged as GRID_UPDATE_DETECTED. Everything else
    // (default `business_signal`, or unset for back-compat) flows through
    // the pre-existing EvidenceExtractor pipeline UNCHANGED.
    if (source.sourceClass === 'grid_update') {
      await this.processGridUpdateSource(source, runId, summary);
      return;
    }

    const extraction = await this.deps.extractor.extract({ source });

    await this.logger.log('EVIDENCE_EXTRACTED', {
      message: extraction.summary,
      metadata: {
        runId,
        sourceUrl: source.url,
        extractor: extraction.extractor,
        signalType: extraction.signalType,
        confidence: extraction.confidence,
      },
    });

    if (!extraction.companyName || extraction.signalType === 'unknown') {
      await this.logger.log('OPPORTUNITY_REJECTED', {
        message: 'No identifiable company or actionable signal',
        metadata: {
          runId,
          sourceUrl: source.url,
          companyName: extraction.companyName,
          signalType: extraction.signalType,
        },
      });
      return;
    }

    const company = await this.upsertCompany(extraction, source);
    summary.companiesProcessed += 1;

    // If this company already has a live opportunity, treat as reassessment.
    const existing = await this.deps.repos.opportunities.findByCompany(company.id);
    const active = existing.find(
      (o) => o.status !== 'rejected' && o.status !== 'actioned',
    );
    if (active) {
      await this.reassessExisting({
        active,
        company,
        extraction,
        source,
        runId,
        summary,
      });
      return;
    }

    // Fresh opportunity path.
    const evidence = await this.insertEvidence(company, extraction, source);
    const signal = await this.insertSignal(company, extraction, evidence);
    summary.signalsDetected += 1;

    const opportunity = await this.persistPlaceholderOpportunity({ company, signal });
    summary.opportunitiesCreated += 1;

    await this.logger.log('SIGNAL_DETECTED', {
      opportunityId: opportunity.id,
      message: `Signal ${signal.type} detected for ${company.name}`,
      metadata: {
        runId,
        companyId: company.id,
        signalId: signal.id,
        impact: signal.estimatedImpactClass,
      },
    });

    const gridContext = await this.deps.grid.getGridContext({
      city: company.city ?? undefined,
    });
    await this.logger.log('GRID_CONTEXT_CHECKED', {
      opportunityId: opportunity.id,
      message: `Grid congestion at ${company.city ?? '?'} = ${gridContext.level} (source=${gridContext.source})`,
      metadata: { runId, companyId: company.id, gridContext },
    });

    const scoring = this.scoring.score({
      signalType: signal.type,
      estimatedImpactClass: signal.estimatedImpactClass,
      extractionConfidence: extraction.confidence,
      sourcePublishedAt: source.publishedAt,
      corroboratingSources: 1,
      onIndustrialPark: false,
      congestion: gridContext,
      now: this.now(),
    });

    opportunity.score = scoring.score;
    opportunity.confidence = signal.confidence;
    opportunity.congestionContext = gridContext;
    opportunity.updatedAt = this.now();
    await this.deps.repos.opportunities.update(opportunity);

    await this.logger.log('OPPORTUNITY_SCORED', {
      opportunityId: opportunity.id,
      message: `Score ${scoring.score} (${scoring.category})`,
      metadata: { runId, components: scoring.components, explanation: scoring.explanation },
    });

    const policyDecision = this.policy.evaluate({
      signalType: signal.type,
      estimatedImpactClass: signal.estimatedImpactClass,
      extractionConfidence: extraction.confidence,
      scoring,
      congestion: gridContext,
      gridNeighborStatus: opportunity.gridNeighborStatus,
      existingStatus: null,
    });
    summary.decisions[policyDecision.decision] += 1;

    await this.persistDecision(opportunity.id, policyDecision);

    // Update status + next step.
    opportunity.status = policyDecision.nextStatus;
    opportunity.recommendedNextStep = policyDecision.recommendedNextStep;
    opportunity.updatedAt = this.now();
    await this.deps.repos.opportunities.update(opportunity);

    // For a CREATE_DOSSIER decision, generate + persist a structured dossier.
    if (policyDecision.decision === 'create_dossier') {
      await this.persistDossier(opportunity, {
        company,
        signal,
        evidenceList: [evidence],
        scoring,
        gridContext,
      });
      await this.logger.log('DOSSIER_CREATED', {
        opportunityId: opportunity.id,
        message: 'Preliminary dossier persisted for human review',
        metadata: { runId },
      });
    }

    // Enqueue the action (V4). Dispatch happens in drainActionQueue().
    await this.enqueueForDecision(policyDecision, opportunity, runId);
  }

  // ---------------------------------------------------------------------------
  // Grid-update source path (Liander / Enexis / Stedin capacity pages).
  // Dedicated extractor; NEVER touches GridContextProvider — that stays
  // municipality-level. Just records what we saw in the activity log.
  // ---------------------------------------------------------------------------

  private async processGridUpdateSource(
    source: DiscoveredSource,
    runId: string,
    summary: AutonomousRunSummary,
  ): Promise<void> {
    const gridUpdate = await this.gridUpdateExtractor.extract({ source });
    summary.gridUpdatesDetected += 1;
    await this.logger.log('GRID_UPDATE_DETECTED', {
      opportunityId: null,
      message: gridUpdate.summary,
      metadata: {
        runId,
        sourceUrl: source.url,
        extractor: gridUpdate.extractor,
        operator: gridUpdate.operator,
        updateType: gridUpdate.updateType,
        mentionedRegions: gridUpdate.mentionedRegions,
        publishedAt: gridUpdate.publishedAt,
        evidenceExcerpt: gridUpdate.evidenceExcerpt,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Reassessment when the same company gets a new source (V4)
  // ---------------------------------------------------------------------------

  private async reassessExisting(params: {
    active: Opportunity;
    company: Company;
    extraction: ExtractionResult;
    source: DiscoveredSource;
    runId: string;
    summary: AutonomousRunSummary;
  }): Promise<void> {
    const { active, company, extraction, source, runId, summary } = params;

    // Persist the new evidence + signal so the audit trail is complete.
    const evidence = await this.insertEvidence(company, extraction, source);
    const signal = await this.insertSignal(company, extraction, evidence);
    summary.signalsDetected += 1;

    // Determine material conflict vs corroboration.
    const priorSignals = await this.deps.repos.signals.listByCompany(company.id);
    const prevTop = priorSignals.find((s) => s.id !== signal.id);
    const conflict = detectConflict(prevTop, signal);

    const gridContext = await this.deps.grid.getGridContext({
      city: company.city ?? undefined,
    });

    // If conflict, reduce the effective confidence (deterministic haircut).
    const effectiveConfidence = conflict
      ? Math.max(0, signal.confidence - 0.25)
      : signal.confidence;

    // Rescore.
    const scoring = this.scoring.score({
      signalType: signal.type,
      estimatedImpactClass: signal.estimatedImpactClass,
      extractionConfidence: effectiveConfidence,
      sourcePublishedAt: source.publishedAt,
      corroboratingSources: conflict ? 1 : priorSignals.length,
      onIndustrialPark: false,
      congestion: gridContext,
      now: this.now(),
    });

    const priorDecisions = await this.deps.repos.decisions.listByOpportunity(active.id);
    const priorDecision = priorDecisions.length > 0 ? priorDecisions[priorDecisions.length - 1] : null;
    const priorScore = active.score;

    // Persist the reassessment context on the opportunity + link the new signal.
    active.signalIds = [...active.signalIds, signal.id];
    active.score = scoring.score;
    active.confidence = effectiveConfidence;
    active.congestionContext = gridContext;
    active.updatedAt = this.now();
    await this.deps.repos.opportunities.update(active);

    const policyDecision = this.policy.evaluate({
      signalType: signal.type,
      estimatedImpactClass: signal.estimatedImpactClass,
      extractionConfidence: effectiveConfidence,
      scoring,
      congestion: gridContext,
      gridNeighborStatus: active.gridNeighborStatus,
      existingStatus: active.status,
    });
    summary.decisions[policyDecision.decision] += 1;
    summary.opportunitiesReassessed += 1;

    await this.persistDecision(active.id, policyDecision);

    await this.logger.log('OPPORTUNITY_REASSESSED', {
      opportunityId: active.id,
      message: conflict
        ? `Conflicting new evidence — score ${priorScore} → ${scoring.score}, decision ${priorDecision?.decisionType ?? 'none'} → ${policyDecision.decision}`
        : `New corroborating evidence — score ${priorScore} → ${scoring.score}`,
      metadata: {
        runId,
        conflict,
        priorScore,
        newScore: scoring.score,
        priorDecision: priorDecision?.decisionType ?? null,
        newDecision: policyDecision.decision,
        triggeringEvidenceId: evidence.id,
        triggeringSourceUrl: source.url,
        reason: policyDecision.reason,
      },
    });

    // If the previous decision would have been dispatched but the new one
    // doesn't warrant it, cancel any queued/undispatched actions.
    if (
      priorDecision &&
      dispatchableAction(priorDecision.decisionType) &&
      !dispatchableAction(policyDecision.decision)
    ) {
      await this.cancelPendingActionsFor(active.id, runId, policyDecision.reason, summary);
    }

    // Update status + next step.
    active.status = policyDecision.nextStatus;
    active.recommendedNextStep = policyDecision.recommendedNextStep;
    active.updatedAt = this.now();
    await this.deps.repos.opportunities.update(active);

    // Enqueue the new action (or none, if not dispatchable).
    if (dispatchableAction(policyDecision.decision)) {
      await this.enqueueForDecision(policyDecision, active, runId);
    }
  }

  // ---------------------------------------------------------------------------
  // Action queue: enqueue + drain with bounded retry (V4 + V6)
  // ---------------------------------------------------------------------------

  private async enqueueForDecision(
    policyDecision: PolicyDecision,
    opportunity: Opportunity,
    runId: string,
  ): Promise<QueuedAction | null> {
    const actionType = dispatchableAction(policyDecision.decision);
    if (!actionType) return null;
    const now = this.now();
    const queued: QueuedAction = {
      id: newId.activity(),
      opportunityId: opportunity.id,
      actionType,
      status: 'pending',
      attempts: 0,
      reason: policyDecision.reason,
      metadata: {
        runId,
        rulesTriggered: policyDecision.rulesTriggered,
        policyVersion: policyDecision.policyVersion,
      },
      lastError: null,
      createdAt: now,
      updatedAt: now,
      dispatchedAt: null,
    };
    return this.deps.repos.actionQueue.enqueue(queued);
  }

  private async drainActionQueue(runId: string, summary: AutonomousRunSummary): Promise<void> {
    const pending = await this.deps.repos.actionQueue.listByStatus('pending');
    for (const item of pending) {
      const opportunity = await this.deps.repos.opportunities.findById(item.opportunityId);
      if (!opportunity) continue;

      // Grid-context safety gate: high-score actions require a KNOWN congestion
      // level. If we get here with unknown grid context and score >= 80, block.
      const congestion = opportunity.congestionContext;
      const gridUnknown = !congestion || congestion.level === 'unknown';
      if (gridUnknown && opportunity.score >= 80) {
        item.status = 'failed';
        item.lastError = 'grid_context_unknown_high_score';
        item.updatedAt = this.now();
        await this.deps.repos.actionQueue.update(item);
        summary.actionsBlocked += 1;
        await this.logger.log('ACTION_BLOCKED', {
          opportunityId: item.opportunityId,
          message: `Action ${item.actionType} blocked: grid context unknown for a high-score (${opportunity.score}) opportunity`,
          metadata: { runId, actionType: item.actionType, score: opportunity.score },
        });
        continue;
      }

      await this.dispatchWithRetry(item, opportunity, runId, summary);
    }
  }

  private async dispatchWithRetry(
    item: QueuedAction,
    opportunity: Opportunity,
    runId: string,
    summary: AutonomousRunSummary,
  ): Promise<void> {
    const payload: AutomationDispatch = {
      actionType: item.actionType as AutomationDispatch['actionType'],
      opportunity,
      reason: item.reason,
      metadata: (item.metadata ?? undefined) as Record<string, unknown> | undefined,
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      item.attempts = attempt;
      try {
        const result = await this.deps.automation.dispatch(payload);
        if (result.dispatched) {
          item.status = 'dispatched';
          item.dispatchedAt = this.now();
          item.updatedAt = this.now();
          item.lastError = null;
          await this.deps.repos.actionQueue.update(item);
          summary.actionsDispatched += 1;
          await this.logger.log('ACTION_DISPATCHED', {
            opportunityId: opportunity.id,
            message: `Action ${item.actionType} dispatched via ${result.provider}${result.info ? ` — ${result.info}` : ''}${attempt > 1 ? ' (after retry)' : ''}`,
            metadata: {
              runId,
              actionType: item.actionType,
              provider: result.provider,
              attempts: attempt,
            },
          });
          return;
        }
        // dispatched=false = provider intentionally didn't send (disabled).
        item.status = 'failed';
        item.lastError = result.info ?? 'automation provider declined';
        item.updatedAt = this.now();
        await this.deps.repos.actionQueue.update(item);
        summary.actionsBlocked += 1;
        await this.logger.log('ACTION_BLOCKED', {
          opportunityId: opportunity.id,
          message: `Action ${item.actionType} blocked: ${result.info ?? 'no provider'}`,
          metadata: { runId, actionType: item.actionType, provider: result.provider },
        });
        return;
      } catch (err) {
        item.lastError = (err as Error).message;
        item.updatedAt = this.now();
        await this.deps.repos.actionQueue.update(item);
        if (attempt === 1) {
          await this.logger.log('RETRY_STARTED', {
            opportunityId: opportunity.id,
            message: `Action ${item.actionType} dispatch failed, retrying once: ${(err as Error).message}`,
            metadata: { runId, actionType: item.actionType },
          });
        } else {
          item.status = 'failed';
          await this.deps.repos.actionQueue.update(item);
          summary.failures += 1;
          await this.logger.log('RETRY_FAILED', {
            opportunityId: opportunity.id,
            message: `Action ${item.actionType} delivery failed after retry: ${(err as Error).message}`,
            metadata: { runId, actionType: item.actionType, attempts: attempt },
          });
          return;
        }
      }
    }
  }

  private async cancelPendingActionsFor(
    opportunityId: string,
    runId: string,
    reason: string,
    summary: AutonomousRunSummary,
  ): Promise<void> {
    const queue = await this.deps.repos.actionQueue.listByOpportunity(opportunityId);
    for (const item of queue) {
      if (item.status !== 'pending') continue;
      item.status = 'cancelled';
      item.lastError = null;
      item.updatedAt = this.now();
      await this.deps.repos.actionQueue.update(item);
      summary.actionsCancelled += 1;
      await this.logger.log('ACTION_BLOCKED', {
        opportunityId,
        message: `Queued action ${item.actionType} cancelled — policy no longer permits it (${reason})`,
        metadata: { runId, cancelled: true, actionType: item.actionType, reason },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Dossier persistence (V2)
  // ---------------------------------------------------------------------------

  private async persistDossier(
    opportunity: Opportunity,
    ctx: DossierAdditionalContext,
  ): Promise<void> {
    const content = buildDossierContent(opportunity, ctx);
    const now = this.now();
    await this.deps.repos.dossiers.upsert({
      id: newId.opportunity(),
      opportunityId: opportunity.id,
      content,
      createdAt: now,
      updatedAt: now,
    });
  }

  // ---------------------------------------------------------------------------
  // Small persistence helpers
  // ---------------------------------------------------------------------------

  private async persistDecision(
    opportunityId: string,
    policyDecision: PolicyDecision,
  ): Promise<void> {
    await this.deps.repos.decisions.insert({
      id: newId.decision(),
      opportunityId,
      decisionType: policyDecision.decision,
      reason: policyDecision.reason,
      policyVersion: policyDecision.policyVersion,
      createdAt: policyDecision.timestamp,
    });
    await this.logger.log('DECISION_MADE', {
      opportunityId,
      message: `Policy: ${policyDecision.decision} — ${policyDecision.reason}`,
      metadata: {
        rulesTriggered: policyDecision.rulesTriggered,
        recommendedNextStep: policyDecision.recommendedNextStep,
      },
    });
  }

  private async finalizeRun(summary: AutonomousRunSummary): Promise<void> {
    await this.logger.log('SCAN_COMPLETED', {
      message: `Scan finished: ${summary.opportunitiesCreated} new, ${summary.opportunitiesReassessed} reassessed, ${summary.actionsDispatched} actions${summary.incomplete ? ' (INCOMPLETE)' : ''}`,
      metadata: { runId: summary.runId, summary },
    });
    const runRecord: RunHistory = {
      id: summary.runId,
      trigger: summary.trigger,
      sourceProvider: summary.sourceProvider,
      extractor: summary.extractor,
      automationProvider: summary.automationProvider,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      sourcesDiscovered: summary.sourcesDiscovered,
      companiesProcessed: summary.companiesProcessed,
      signalsDetected: summary.signalsDetected,
      opportunitiesCreated: summary.opportunitiesCreated,
      actionsDispatched: summary.actionsDispatched,
      actionsBlocked: summary.actionsBlocked,
      failures: summary.failures,
      incomplete: summary.incomplete,
      decisions: summary.decisions,
      notes: summary.notes,
    };
    await this.deps.repos.runs.insert(runRecord);
  }

  private async upsertCompany(
    extraction: ExtractionResult,
    source: DiscoveredSource,
  ): Promise<Company> {
    const name = extraction.companyName as string;
    const existing = await this.deps.repos.companies.findByName(name);
    const now = this.now();
    if (existing) {
      const updated: Company = {
        ...existing,
        city: existing.city ?? extraction.location.city,
        address: existing.address ?? extraction.location.address,
        sourceUrls: unique([...existing.sourceUrls, source.url]),
        updatedAt: now,
      };
      return this.deps.repos.companies.upsert(updated);
    }
    const created: Company = {
      id: newId.company(),
      name,
      website: null,
      address: extraction.location.address,
      city: extraction.location.city,
      latitude: null,
      longitude: null,
      sector: null,
      sourceUrls: [source.url],
      createdAt: now,
      updatedAt: now,
    };
    return this.deps.repos.companies.upsert(created);
  }

  private async insertEvidence(
    company: Company,
    extraction: ExtractionResult,
    source: DiscoveredSource,
  ): Promise<Evidence> {
    const evidence: Evidence = {
      id: newId.evidence(),
      companyId: company.id,
      sourceUrl: source.url,
      sourceTitle: source.title,
      sourceType: extraction.sourceType,
      excerpt: extraction.evidenceExcerpt,
      detectedAt: this.now(),
      publishedAt: source.publishedAt,
      rawTextHash: sha256(source.rawText),
      confidence: extraction.confidence,
    };
    return this.deps.repos.evidence.insert(evidence);
  }

  private async insertSignal(
    company: Company,
    extraction: ExtractionResult,
    evidence: Evidence,
  ): Promise<Signal> {
    const signal: Signal = {
      id: newId.signal(),
      companyId: company.id,
      evidenceIds: [evidence.id],
      type: extraction.signalType,
      description: extraction.summary,
      estimatedImpactClass: extraction.estimatedImpactClass,
      confidence: extraction.confidence,
      detectedAt: this.now(),
    };
    return this.deps.repos.signals.insert(signal);
  }

  private async persistPlaceholderOpportunity(params: {
    company: Company;
    signal: Signal;
  }): Promise<Opportunity> {
    const now = this.now();
    const opportunity: Opportunity = {
      id: newId.opportunity(),
      companyId: params.company.id,
      signalIds: [params.signal.id],
      status: 'detected',
      score: 0,
      confidence: params.signal.confidence,
      congestionContext: null,
      gridNeighborStatus: 'unknown',
      recommendedNextStep: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.deps.repos.opportunities.insert(opportunity);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DispatchableAction =
  | 'create_dossier'
  | 'notify_stakeholder'
  | 'request_human_review'
  | 'request_grid_verification';

function dispatchableAction(decision: DecisionType): DispatchableAction | null {
  switch (decision) {
    case 'create_dossier':
      return 'create_dossier';
    case 'request_human':
      return 'request_human_review';
    case 'notify_stakeholder':
      return 'notify_stakeholder';
    case 'request_grid_verification':
      return 'request_grid_verification';
    default:
      return null;
  }
}

const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };

/**
 * Material conflict:
 *   - different signal type, OR
 *   - new impact class strictly lower than the prior top signal, OR
 *   - new confidence is >0.30 lower than the prior signal's confidence.
 */
function detectConflict(prev: Signal | undefined, next: Signal): boolean {
  if (!prev) return false;
  if (prev.type !== next.type) return true;
  if ((IMPACT_RANK[next.estimatedImpactClass] ?? 0) < (IMPACT_RANK[prev.estimatedImpactClass] ?? 0)) return true;
  if (prev.confidence - next.confidence > 0.3) return true;
  return false;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
