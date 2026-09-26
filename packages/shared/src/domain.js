import { z } from 'zod';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const SourceType = z.enum([
    'company_news',
    'sustainability_page',
    'vacancy',
    'planning_notice',
    'industrial_park',
    'news_article',
    'other',
]);
export const SignalType = z.enum([
    'fleet_electrification',
    'facility_expansion',
    'electric_machinery',
    'heat_electrification',
    'solar_installation',
    'battery_installation',
    'charging_infrastructure',
    'sustainability_target',
    'energy_hiring',
    'unknown',
]);
export const ImpactClass = z.enum(['low', 'medium', 'high', 'unknown']);
export const OpportunityStatus = z.enum([
    'detected',
    'investigating',
    'promising',
    'blocked',
    'rejected',
    'escalated',
    'actioned',
]);
export const GridNeighborStatus = z.enum(['unknown', 'unverified', 'verified']);
export const CongestionLevel = z.enum(['low', 'moderate', 'high', 'severe', 'unknown']);
export const DecisionType = z.enum([
    'continue_investigation',
    'stop',
    'request_human',
    'create_dossier',
    'notify_stakeholder',
    'request_grid_verification',
]);
export const ActivityEventType = z.enum([
    'SCAN_STARTED',
    'SOURCE_DISCOVERED',
    'EVIDENCE_EXTRACTED',
    'SIGNAL_DETECTED',
    'GRID_CONTEXT_CHECKED',
    'OPPORTUNITY_SCORED',
    'DECISION_MADE',
    'DOSSIER_CREATED',
    'ACTION_BLOCKED',
    'HUMAN_REVIEW_REQUESTED',
    'RETRY_STARTED',
    'RETRY_SUCCEEDED',
    'RETRY_FAILED',
    'OPPORTUNITY_REASSESSED',
    'OPPORTUNITY_REJECTED',
    'SCAN_COMPLETED',
    'ACTION_DISPATCHED',
]);
// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
const IsoDate = z.string().datetime({ offset: true });
export const CompanySchema = z.object({
    id: z.string(),
    name: z.string().min(1),
    website: z.string().url().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    sector: z.string().nullable(),
    sourceUrls: z.array(z.string().url()),
    createdAt: IsoDate,
    updatedAt: IsoDate,
});
export const EvidenceSchema = z.object({
    id: z.string(),
    companyId: z.string(),
    sourceUrl: z.string().url(),
    sourceTitle: z.string(),
    sourceType: SourceType,
    excerpt: z.string(),
    detectedAt: IsoDate,
    publishedAt: IsoDate.nullable(),
    rawTextHash: z.string(),
    confidence: z.number().min(0).max(1),
});
export const SignalSchema = z.object({
    id: z.string(),
    companyId: z.string(),
    evidenceIds: z.array(z.string()).min(1),
    type: SignalType,
    description: z.string(),
    estimatedImpactClass: ImpactClass,
    confidence: z.number().min(0).max(1),
    detectedAt: IsoDate,
});
export const CongestionContextSchema = z.object({
    level: CongestionLevel,
    source: z.string(),
    sourceUrl: z.string().url().nullable(),
    checkedAt: IsoDate,
    notes: z.string().nullable(),
});
export const OpportunitySchema = z.object({
    id: z.string(),
    companyId: z.string(),
    signalIds: z.array(z.string()).min(1),
    status: OpportunityStatus,
    score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    congestionContext: CongestionContextSchema.nullable(),
    gridNeighborStatus: GridNeighborStatus,
    recommendedNextStep: z.string().nullable(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
});
export const DecisionSchema = z.object({
    id: z.string(),
    opportunityId: z.string(),
    decisionType: DecisionType,
    reason: z.string(),
    policyVersion: z.string(),
    createdAt: IsoDate,
});
export const ActivityLogSchema = z.object({
    id: z.string(),
    opportunityId: z.string().nullable(),
    eventType: ActivityEventType,
    message: z.string(),
    metadata: z.record(z.unknown()).nullable(),
    createdAt: IsoDate,
});
// ---------------------------------------------------------------------------
// Run history — added in validation phase (V1)
// ---------------------------------------------------------------------------
export const RunTrigger = z.enum(['manual', 'scheduled', 'demo']);
export const RunHistorySchema = z.object({
    id: z.string(),
    trigger: RunTrigger,
    sourceProvider: z.string(),
    extractor: z.string(),
    automationProvider: z.string(),
    startedAt: IsoDate,
    finishedAt: IsoDate,
    sourcesDiscovered: z.number().int().nonnegative(),
    companiesProcessed: z.number().int().nonnegative(),
    signalsDetected: z.number().int().nonnegative(),
    opportunitiesCreated: z.number().int().nonnegative(),
    actionsDispatched: z.number().int().nonnegative(),
    actionsBlocked: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    incomplete: z.boolean(),
    decisions: z.record(z.number().int().nonnegative()),
    notes: z.string().nullable(),
});
// ---------------------------------------------------------------------------
// Dossier — added in validation phase (V2)
// ---------------------------------------------------------------------------
export const DossierContentSchema = z.object({
    company: z.object({
        name: z.string(),
        city: z.string().nullable(),
        address: z.string().nullable(),
    }),
    signal: z.object({
        type: z.string(),
        description: z.string(),
        estimatedImpactClass: z.string(),
        confidence: z.number(),
    }),
    evidence: z.array(z.object({
        sourceUrl: z.string(),
        sourceTitle: z.string(),
        excerpt: z.string(),
        publishedAt: z.string().nullable(),
        confidence: z.number(),
    })),
    scoreBreakdown: z.object({
        score: z.number(),
        category: z.string(),
        components: z.record(z.number()),
        explanation: z.array(z.string()),
    }),
    gridContext: z
        .object({
        level: z.string(),
        source: z.string(),
        sourceUrl: z.string().nullable(),
        notes: z.string().nullable(),
    })
        .nullable(),
    uncertainty: z.array(z.string()),
    whatWeDoNotKnow: z.array(z.string()),
    missingInformation: z.array(z.string()),
    recommendedNextStep: z.string(),
});
export const DossierSchema = z.object({
    id: z.string(),
    opportunityId: z.string(),
    content: DossierContentSchema,
    createdAt: IsoDate,
    updatedAt: IsoDate,
});
// ---------------------------------------------------------------------------
// Action queue — added in validation phase (V4)
// ---------------------------------------------------------------------------
export const QueueStatus = z.enum(['pending', 'dispatched', 'cancelled', 'failed']);
export const QueuedActionSchema = z.object({
    id: z.string(),
    opportunityId: z.string(),
    actionType: z.string(),
    status: QueueStatus,
    attempts: z.number().int().nonnegative(),
    reason: z.string(),
    metadata: z.record(z.unknown()).nullable(),
    lastError: z.string().nullable(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    dispatchedAt: IsoDate.nullable(),
});
