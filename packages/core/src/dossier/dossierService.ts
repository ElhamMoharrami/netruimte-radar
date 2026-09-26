import type {
  CongestionContext,
  Dossier,
  DossierContent,
  Evidence,
  Opportunity,
  Repositories,
  Signal,
  Company,
} from '@netruimte/shared';
import { newId, nowIso } from '@netruimte/shared';
import type { ScoringResult } from '../scoring/index.js';

export interface DossierAdditionalContext {
  company: Company;
  signal: Signal;
  evidenceList: Evidence[];
  scoring: ScoringResult;
  gridContext: CongestionContext | null;
}

/**
 * Build the structured dossier body from the opportunity + its context.
 *
 * Rule of thumb (audit): everything in `whatWeDoNotKnow` and
 * `missingInformation` is meant to be visible to the human reviewer BEFORE the
 * numeric summary — the point of a dossier is to make the gaps explicit, not
 * hide them.
 */
export function buildDossierContent(
  opportunity: Opportunity,
  ctx: DossierAdditionalContext,
): DossierContent {
  const { company, signal, evidenceList, scoring, gridContext } = ctx;

  const uncertainty: string[] = [];
  const whatWeDoNotKnow: string[] = [];
  const missingInformation: string[] = [];

  if (signal.confidence < 0.75) {
    uncertainty.push(
      `Extractor confidence for the primary signal is ${signal.confidence.toFixed(2)} — treat as tentative until corroborated.`,
    );
  }
  if (signal.estimatedImpactClass === 'unknown') {
    uncertainty.push('Grid-demand impact class is unknown for this signal.');
  }
  if (!gridContext || gridContext.level === 'unknown') {
    uncertainty.push(
      'Grid congestion at this location could not be established from an authoritative source.',
    );
  }
  if (evidenceList.length < 2) {
    uncertainty.push('Only one source supports this signal — no corroborating evidence yet.');
  }

  whatWeDoNotKnow.push(
    'Whether this company shares a grid connection with any neighbouring business — no verified grid-topology data available.',
  );
  whatWeDoNotKnow.push(
    'Actual (kW) electricity consumption impact of the described change — we did not observe or infer meter data.',
  );
  whatWeDoNotKnow.push(
    'Whether the described change has already been commissioned or is still in permitting/procurement.',
  );

  if (!company.address) missingInformation.push('Company street address is not on file.');
  if (!company.city) missingInformation.push('Company city is not on file.');
  if (!company.website) missingInformation.push('Company website is not on file.');
  if (evidenceList.every((e) => e.publishedAt === null)) {
    missingInformation.push(
      'Publication date is missing for every evidence source — timing score is a best-effort estimate.',
    );
  }

  const content: DossierContent = {
    company: {
      name: company.name,
      city: company.city,
      address: company.address,
    },
    signal: {
      type: signal.type,
      description: signal.description,
      estimatedImpactClass: signal.estimatedImpactClass,
      confidence: signal.confidence,
    },
    evidence: evidenceList.map((e) => ({
      sourceUrl: e.sourceUrl,
      sourceTitle: e.sourceTitle,
      excerpt: e.excerpt,
      publishedAt: e.publishedAt,
      confidence: e.confidence,
    })),
    scoreBreakdown: {
      score: scoring.score,
      category: scoring.category,
      components: { ...scoring.components },
      explanation: scoring.explanation,
    },
    gridContext: gridContext
      ? {
          level: gridContext.level,
          source: gridContext.source,
          sourceUrl: gridContext.sourceUrl,
          notes: gridContext.notes,
        }
      : null,
    uncertainty,
    whatWeDoNotKnow,
    missingInformation,
    recommendedNextStep: opportunity.recommendedNextStep ?? 'Escalate to human reviewer.',
  };
  return content;
}

/**
 * Convenience service used by API routes that want to create/refresh a dossier
 * without running the full pipeline. The core pipeline calls
 * `buildDossierContent` directly (see AutonomousRunService).
 */
export class OpportunityDossierService {
  constructor(private readonly repos: Repositories) {}

  async generateForOpportunity(opportunityId: string): Promise<Dossier | null> {
    const opportunity = await this.repos.opportunities.findById(opportunityId);
    if (!opportunity) return null;
    const company = await this.repos.companies.findById(opportunity.companyId);
    if (!company) return null;
    const evidenceList = await this.repos.evidence.listByCompany(company.id);
    const signals = await this.repos.signals.listByCompany(company.id);
    if (signals.length === 0) return null;
    // Prefer the signal linked most recently to the opportunity.
    const lastLinkedId = opportunity.signalIds[opportunity.signalIds.length - 1];
    const signal = signals.find((s) => s.id === lastLinkedId) ?? signals[0]!;
    // Re-derive score explanation from the persisted opportunity fields — we
    // don't re-run the scorer here because that would silently change history.
    const dossier: Dossier = {
      id: newId.opportunity(),
      opportunityId: opportunity.id,
      content: buildDossierContent(opportunity, {
        company,
        signal,
        evidenceList,
        scoring: {
          score: opportunity.score,
          category: opportunity.score >= 80
            ? 'create_dossier'
            : opportunity.score >= 65
              ? 'promising'
              : opportunity.score >= 40
                ? 'investigate_more'
                : 'reject',
          components: {
            signalStrength: 0,
            confidence: 0,
            congestion: 0,
            timing: 0,
            corroboration: 0,
            gridEventCorrelation: 0,
            collaboration: 0,
          },
          explanation: ['Rebuilt from persisted opportunity — component breakdown not stored.'],
        },
        gridContext: opportunity.congestionContext,
      }),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return this.repos.dossiers.upsert(dossier);
  }

  async getForOpportunity(opportunityId: string): Promise<Dossier | null> {
    const existing = await this.repos.dossiers.findByOpportunity(opportunityId);
    if (existing) return existing;
    return this.generateForOpportunity(opportunityId);
  }
}
