import { z } from 'zod';
export declare const SourceType: z.ZodEnum<["company_news", "sustainability_page", "vacancy", "planning_notice", "industrial_park", "news_article", "other"]>;
export type SourceType = z.infer<typeof SourceType>;
export declare const SignalType: z.ZodEnum<["fleet_electrification", "facility_expansion", "electric_machinery", "heat_electrification", "solar_installation", "battery_installation", "charging_infrastructure", "sustainability_target", "energy_hiring", "unknown"]>;
export type SignalType = z.infer<typeof SignalType>;
export declare const ImpactClass: z.ZodEnum<["low", "medium", "high", "unknown"]>;
export type ImpactClass = z.infer<typeof ImpactClass>;
export declare const OpportunityStatus: z.ZodEnum<["detected", "investigating", "promising", "blocked", "rejected", "escalated", "actioned"]>;
export type OpportunityStatus = z.infer<typeof OpportunityStatus>;
export declare const GridNeighborStatus: z.ZodEnum<["unknown", "unverified", "verified"]>;
export type GridNeighborStatus = z.infer<typeof GridNeighborStatus>;
export declare const CongestionLevel: z.ZodEnum<["low", "moderate", "high", "severe", "unknown"]>;
export type CongestionLevel = z.infer<typeof CongestionLevel>;
export declare const DecisionType: z.ZodEnum<["continue_investigation", "stop", "request_human", "create_dossier", "notify_stakeholder", "request_grid_verification"]>;
export type DecisionType = z.infer<typeof DecisionType>;
export declare const ActivityEventType: z.ZodEnum<["SCAN_STARTED", "SOURCE_DISCOVERED", "EVIDENCE_EXTRACTED", "SIGNAL_DETECTED", "GRID_CONTEXT_CHECKED", "OPPORTUNITY_SCORED", "DECISION_MADE", "DOSSIER_CREATED", "ACTION_BLOCKED", "HUMAN_REVIEW_REQUESTED", "RETRY_STARTED", "RETRY_SUCCEEDED", "RETRY_FAILED", "OPPORTUNITY_REASSESSED", "OPPORTUNITY_REJECTED", "SCAN_COMPLETED", "ACTION_DISPATCHED"]>;
export type ActivityEventType = z.infer<typeof ActivityEventType>;
export declare const CompanySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    website: z.ZodNullable<z.ZodString>;
    address: z.ZodNullable<z.ZodString>;
    city: z.ZodNullable<z.ZodString>;
    latitude: z.ZodNullable<z.ZodNumber>;
    longitude: z.ZodNullable<z.ZodNumber>;
    sector: z.ZodNullable<z.ZodString>;
    sourceUrls: z.ZodArray<z.ZodString, "many">;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    website: string | null;
    address: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    sector: string | null;
    sourceUrls: string[];
    createdAt: string;
    updatedAt: string;
}, {
    id: string;
    name: string;
    website: string | null;
    address: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    sector: string | null;
    sourceUrls: string[];
    createdAt: string;
    updatedAt: string;
}>;
export type Company = z.infer<typeof CompanySchema>;
export declare const EvidenceSchema: z.ZodObject<{
    id: z.ZodString;
    companyId: z.ZodString;
    sourceUrl: z.ZodString;
    sourceTitle: z.ZodString;
    sourceType: z.ZodEnum<["company_news", "sustainability_page", "vacancy", "planning_notice", "industrial_park", "news_article", "other"]>;
    excerpt: z.ZodString;
    detectedAt: z.ZodString;
    publishedAt: z.ZodNullable<z.ZodString>;
    rawTextHash: z.ZodString;
    confidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    sourceType: "company_news" | "sustainability_page" | "vacancy" | "planning_notice" | "industrial_park" | "news_article" | "other";
    publishedAt: string | null;
    id: string;
    companyId: string;
    sourceUrl: string;
    sourceTitle: string;
    excerpt: string;
    detectedAt: string;
    rawTextHash: string;
    confidence: number;
}, {
    sourceType: "company_news" | "sustainability_page" | "vacancy" | "planning_notice" | "industrial_park" | "news_article" | "other";
    publishedAt: string | null;
    id: string;
    companyId: string;
    sourceUrl: string;
    sourceTitle: string;
    excerpt: string;
    detectedAt: string;
    rawTextHash: string;
    confidence: number;
}>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export declare const SignalSchema: z.ZodObject<{
    id: z.ZodString;
    companyId: z.ZodString;
    evidenceIds: z.ZodArray<z.ZodString, "many">;
    type: z.ZodEnum<["fleet_electrification", "facility_expansion", "electric_machinery", "heat_electrification", "solar_installation", "battery_installation", "charging_infrastructure", "sustainability_target", "energy_hiring", "unknown"]>;
    description: z.ZodString;
    estimatedImpactClass: z.ZodEnum<["low", "medium", "high", "unknown"]>;
    confidence: z.ZodNumber;
    detectedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "fleet_electrification" | "facility_expansion" | "electric_machinery" | "heat_electrification" | "solar_installation" | "battery_installation" | "charging_infrastructure" | "sustainability_target" | "energy_hiring" | "unknown";
    id: string;
    companyId: string;
    detectedAt: string;
    confidence: number;
    evidenceIds: string[];
    description: string;
    estimatedImpactClass: "unknown" | "low" | "medium" | "high";
}, {
    type: "fleet_electrification" | "facility_expansion" | "electric_machinery" | "heat_electrification" | "solar_installation" | "battery_installation" | "charging_infrastructure" | "sustainability_target" | "energy_hiring" | "unknown";
    id: string;
    companyId: string;
    detectedAt: string;
    confidence: number;
    evidenceIds: string[];
    description: string;
    estimatedImpactClass: "unknown" | "low" | "medium" | "high";
}>;
export type Signal = z.infer<typeof SignalSchema>;
export declare const CongestionContextSchema: z.ZodObject<{
    level: z.ZodEnum<["low", "moderate", "high", "severe", "unknown"]>;
    source: z.ZodString;
    sourceUrl: z.ZodNullable<z.ZodString>;
    checkedAt: z.ZodString;
    notes: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sourceUrl: string | null;
    level: "unknown" | "low" | "high" | "moderate" | "severe";
    source: string;
    checkedAt: string;
    notes: string | null;
}, {
    sourceUrl: string | null;
    level: "unknown" | "low" | "high" | "moderate" | "severe";
    source: string;
    checkedAt: string;
    notes: string | null;
}>;
export type CongestionContext = z.infer<typeof CongestionContextSchema>;
export declare const OpportunitySchema: z.ZodObject<{
    id: z.ZodString;
    companyId: z.ZodString;
    signalIds: z.ZodArray<z.ZodString, "many">;
    status: z.ZodEnum<["detected", "investigating", "promising", "blocked", "rejected", "escalated", "actioned"]>;
    score: z.ZodNumber;
    confidence: z.ZodNumber;
    congestionContext: z.ZodNullable<z.ZodObject<{
        level: z.ZodEnum<["low", "moderate", "high", "severe", "unknown"]>;
        source: z.ZodString;
        sourceUrl: z.ZodNullable<z.ZodString>;
        checkedAt: z.ZodString;
        notes: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sourceUrl: string | null;
        level: "unknown" | "low" | "high" | "moderate" | "severe";
        source: string;
        checkedAt: string;
        notes: string | null;
    }, {
        sourceUrl: string | null;
        level: "unknown" | "low" | "high" | "moderate" | "severe";
        source: string;
        checkedAt: string;
        notes: string | null;
    }>>;
    gridNeighborStatus: z.ZodEnum<["unknown", "unverified", "verified"]>;
    recommendedNextStep: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "detected" | "investigating" | "promising" | "blocked" | "rejected" | "escalated" | "actioned";
    id: string;
    createdAt: string;
    updatedAt: string;
    companyId: string;
    confidence: number;
    signalIds: string[];
    score: number;
    congestionContext: {
        sourceUrl: string | null;
        level: "unknown" | "low" | "high" | "moderate" | "severe";
        source: string;
        checkedAt: string;
        notes: string | null;
    } | null;
    gridNeighborStatus: "unknown" | "unverified" | "verified";
    recommendedNextStep: string | null;
}, {
    status: "detected" | "investigating" | "promising" | "blocked" | "rejected" | "escalated" | "actioned";
    id: string;
    createdAt: string;
    updatedAt: string;
    companyId: string;
    confidence: number;
    signalIds: string[];
    score: number;
    congestionContext: {
        sourceUrl: string | null;
        level: "unknown" | "low" | "high" | "moderate" | "severe";
        source: string;
        checkedAt: string;
        notes: string | null;
    } | null;
    gridNeighborStatus: "unknown" | "unverified" | "verified";
    recommendedNextStep: string | null;
}>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
export declare const DecisionSchema: z.ZodObject<{
    id: z.ZodString;
    opportunityId: z.ZodString;
    decisionType: z.ZodEnum<["continue_investigation", "stop", "request_human", "create_dossier", "notify_stakeholder", "request_grid_verification"]>;
    reason: z.ZodString;
    policyVersion: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    opportunityId: string;
    decisionType: "continue_investigation" | "stop" | "request_human" | "create_dossier" | "notify_stakeholder" | "request_grid_verification";
    reason: string;
    policyVersion: string;
}, {
    id: string;
    createdAt: string;
    opportunityId: string;
    decisionType: "continue_investigation" | "stop" | "request_human" | "create_dossier" | "notify_stakeholder" | "request_grid_verification";
    reason: string;
    policyVersion: string;
}>;
export type Decision = z.infer<typeof DecisionSchema>;
export declare const ActivityLogSchema: z.ZodObject<{
    id: z.ZodString;
    opportunityId: z.ZodNullable<z.ZodString>;
    eventType: z.ZodEnum<["SCAN_STARTED", "SOURCE_DISCOVERED", "EVIDENCE_EXTRACTED", "SIGNAL_DETECTED", "GRID_CONTEXT_CHECKED", "OPPORTUNITY_SCORED", "DECISION_MADE", "DOSSIER_CREATED", "ACTION_BLOCKED", "HUMAN_REVIEW_REQUESTED", "RETRY_STARTED", "RETRY_SUCCEEDED", "RETRY_FAILED", "OPPORTUNITY_REASSESSED", "OPPORTUNITY_REJECTED", "SCAN_COMPLETED", "ACTION_DISPATCHED"]>;
    message: z.ZodString;
    metadata: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    id: string;
    createdAt: string;
    opportunityId: string | null;
    eventType: "SCAN_STARTED" | "SOURCE_DISCOVERED" | "EVIDENCE_EXTRACTED" | "SIGNAL_DETECTED" | "GRID_CONTEXT_CHECKED" | "OPPORTUNITY_SCORED" | "DECISION_MADE" | "DOSSIER_CREATED" | "ACTION_BLOCKED" | "HUMAN_REVIEW_REQUESTED" | "RETRY_STARTED" | "RETRY_SUCCEEDED" | "RETRY_FAILED" | "OPPORTUNITY_REASSESSED" | "OPPORTUNITY_REJECTED" | "SCAN_COMPLETED" | "ACTION_DISPATCHED";
    metadata: Record<string, unknown> | null;
}, {
    message: string;
    id: string;
    createdAt: string;
    opportunityId: string | null;
    eventType: "SCAN_STARTED" | "SOURCE_DISCOVERED" | "EVIDENCE_EXTRACTED" | "SIGNAL_DETECTED" | "GRID_CONTEXT_CHECKED" | "OPPORTUNITY_SCORED" | "DECISION_MADE" | "DOSSIER_CREATED" | "ACTION_BLOCKED" | "HUMAN_REVIEW_REQUESTED" | "RETRY_STARTED" | "RETRY_SUCCEEDED" | "RETRY_FAILED" | "OPPORTUNITY_REASSESSED" | "OPPORTUNITY_REJECTED" | "SCAN_COMPLETED" | "ACTION_DISPATCHED";
    metadata: Record<string, unknown> | null;
}>;
export type ActivityLog = z.infer<typeof ActivityLogSchema>;
export declare const RunTrigger: z.ZodEnum<["manual", "scheduled", "demo"]>;
export type RunTrigger = z.infer<typeof RunTrigger>;
export declare const RunHistorySchema: z.ZodObject<{
    id: z.ZodString;
    trigger: z.ZodEnum<["manual", "scheduled", "demo"]>;
    sourceProvider: z.ZodString;
    extractor: z.ZodString;
    automationProvider: z.ZodString;
    startedAt: z.ZodString;
    finishedAt: z.ZodString;
    sourcesDiscovered: z.ZodNumber;
    companiesProcessed: z.ZodNumber;
    signalsDetected: z.ZodNumber;
    opportunitiesCreated: z.ZodNumber;
    actionsDispatched: z.ZodNumber;
    actionsBlocked: z.ZodNumber;
    failures: z.ZodNumber;
    incomplete: z.ZodBoolean;
    decisions: z.ZodRecord<z.ZodString, z.ZodNumber>;
    notes: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    notes: string | null;
    trigger: "demo" | "manual" | "scheduled";
    sourceProvider: string;
    extractor: string;
    automationProvider: string;
    startedAt: string;
    finishedAt: string;
    sourcesDiscovered: number;
    companiesProcessed: number;
    signalsDetected: number;
    opportunitiesCreated: number;
    actionsDispatched: number;
    actionsBlocked: number;
    failures: number;
    incomplete: boolean;
    decisions: Record<string, number>;
}, {
    id: string;
    notes: string | null;
    trigger: "demo" | "manual" | "scheduled";
    sourceProvider: string;
    extractor: string;
    automationProvider: string;
    startedAt: string;
    finishedAt: string;
    sourcesDiscovered: number;
    companiesProcessed: number;
    signalsDetected: number;
    opportunitiesCreated: number;
    actionsDispatched: number;
    actionsBlocked: number;
    failures: number;
    incomplete: boolean;
    decisions: Record<string, number>;
}>;
export type RunHistory = z.infer<typeof RunHistorySchema>;
export declare const DossierContentSchema: z.ZodObject<{
    company: z.ZodObject<{
        name: z.ZodString;
        city: z.ZodNullable<z.ZodString>;
        address: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        address: string | null;
        city: string | null;
    }, {
        name: string;
        address: string | null;
        city: string | null;
    }>;
    signal: z.ZodObject<{
        type: z.ZodString;
        description: z.ZodString;
        estimatedImpactClass: z.ZodString;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        confidence: number;
        description: string;
        estimatedImpactClass: string;
    }, {
        type: string;
        confidence: number;
        description: string;
        estimatedImpactClass: string;
    }>;
    evidence: z.ZodArray<z.ZodObject<{
        sourceUrl: z.ZodString;
        sourceTitle: z.ZodString;
        excerpt: z.ZodString;
        publishedAt: z.ZodNullable<z.ZodString>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        publishedAt: string | null;
        sourceUrl: string;
        sourceTitle: string;
        excerpt: string;
        confidence: number;
    }, {
        publishedAt: string | null;
        sourceUrl: string;
        sourceTitle: string;
        excerpt: string;
        confidence: number;
    }>, "many">;
    scoreBreakdown: z.ZodObject<{
        score: z.ZodNumber;
        category: z.ZodString;
        components: z.ZodRecord<z.ZodString, z.ZodNumber>;
        explanation: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        score: number;
        category: string;
        components: Record<string, number>;
        explanation: string[];
    }, {
        score: number;
        category: string;
        components: Record<string, number>;
        explanation: string[];
    }>;
    gridContext: z.ZodNullable<z.ZodObject<{
        level: z.ZodString;
        source: z.ZodString;
        sourceUrl: z.ZodNullable<z.ZodString>;
        notes: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sourceUrl: string | null;
        level: string;
        source: string;
        notes: string | null;
    }, {
        sourceUrl: string | null;
        level: string;
        source: string;
        notes: string | null;
    }>>;
    uncertainty: z.ZodArray<z.ZodString, "many">;
    whatWeDoNotKnow: z.ZodArray<z.ZodString, "many">;
    missingInformation: z.ZodArray<z.ZodString, "many">;
    recommendedNextStep: z.ZodString;
}, "strip", z.ZodTypeAny, {
    recommendedNextStep: string;
    company: {
        name: string;
        address: string | null;
        city: string | null;
    };
    signal: {
        type: string;
        confidence: number;
        description: string;
        estimatedImpactClass: string;
    };
    evidence: {
        publishedAt: string | null;
        sourceUrl: string;
        sourceTitle: string;
        excerpt: string;
        confidence: number;
    }[];
    scoreBreakdown: {
        score: number;
        category: string;
        components: Record<string, number>;
        explanation: string[];
    };
    gridContext: {
        sourceUrl: string | null;
        level: string;
        source: string;
        notes: string | null;
    } | null;
    uncertainty: string[];
    whatWeDoNotKnow: string[];
    missingInformation: string[];
}, {
    recommendedNextStep: string;
    company: {
        name: string;
        address: string | null;
        city: string | null;
    };
    signal: {
        type: string;
        confidence: number;
        description: string;
        estimatedImpactClass: string;
    };
    evidence: {
        publishedAt: string | null;
        sourceUrl: string;
        sourceTitle: string;
        excerpt: string;
        confidence: number;
    }[];
    scoreBreakdown: {
        score: number;
        category: string;
        components: Record<string, number>;
        explanation: string[];
    };
    gridContext: {
        sourceUrl: string | null;
        level: string;
        source: string;
        notes: string | null;
    } | null;
    uncertainty: string[];
    whatWeDoNotKnow: string[];
    missingInformation: string[];
}>;
export type DossierContent = z.infer<typeof DossierContentSchema>;
export declare const DossierSchema: z.ZodObject<{
    id: z.ZodString;
    opportunityId: z.ZodString;
    content: z.ZodObject<{
        company: z.ZodObject<{
            name: z.ZodString;
            city: z.ZodNullable<z.ZodString>;
            address: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            address: string | null;
            city: string | null;
        }, {
            name: string;
            address: string | null;
            city: string | null;
        }>;
        signal: z.ZodObject<{
            type: z.ZodString;
            description: z.ZodString;
            estimatedImpactClass: z.ZodString;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            type: string;
            confidence: number;
            description: string;
            estimatedImpactClass: string;
        }, {
            type: string;
            confidence: number;
            description: string;
            estimatedImpactClass: string;
        }>;
        evidence: z.ZodArray<z.ZodObject<{
            sourceUrl: z.ZodString;
            sourceTitle: z.ZodString;
            excerpt: z.ZodString;
            publishedAt: z.ZodNullable<z.ZodString>;
            confidence: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            publishedAt: string | null;
            sourceUrl: string;
            sourceTitle: string;
            excerpt: string;
            confidence: number;
        }, {
            publishedAt: string | null;
            sourceUrl: string;
            sourceTitle: string;
            excerpt: string;
            confidence: number;
        }>, "many">;
        scoreBreakdown: z.ZodObject<{
            score: z.ZodNumber;
            category: z.ZodString;
            components: z.ZodRecord<z.ZodString, z.ZodNumber>;
            explanation: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            score: number;
            category: string;
            components: Record<string, number>;
            explanation: string[];
        }, {
            score: number;
            category: string;
            components: Record<string, number>;
            explanation: string[];
        }>;
        gridContext: z.ZodNullable<z.ZodObject<{
            level: z.ZodString;
            source: z.ZodString;
            sourceUrl: z.ZodNullable<z.ZodString>;
            notes: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            sourceUrl: string | null;
            level: string;
            source: string;
            notes: string | null;
        }, {
            sourceUrl: string | null;
            level: string;
            source: string;
            notes: string | null;
        }>>;
        uncertainty: z.ZodArray<z.ZodString, "many">;
        whatWeDoNotKnow: z.ZodArray<z.ZodString, "many">;
        missingInformation: z.ZodArray<z.ZodString, "many">;
        recommendedNextStep: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        recommendedNextStep: string;
        company: {
            name: string;
            address: string | null;
            city: string | null;
        };
        signal: {
            type: string;
            confidence: number;
            description: string;
            estimatedImpactClass: string;
        };
        evidence: {
            publishedAt: string | null;
            sourceUrl: string;
            sourceTitle: string;
            excerpt: string;
            confidence: number;
        }[];
        scoreBreakdown: {
            score: number;
            category: string;
            components: Record<string, number>;
            explanation: string[];
        };
        gridContext: {
            sourceUrl: string | null;
            level: string;
            source: string;
            notes: string | null;
        } | null;
        uncertainty: string[];
        whatWeDoNotKnow: string[];
        missingInformation: string[];
    }, {
        recommendedNextStep: string;
        company: {
            name: string;
            address: string | null;
            city: string | null;
        };
        signal: {
            type: string;
            confidence: number;
            description: string;
            estimatedImpactClass: string;
        };
        evidence: {
            publishedAt: string | null;
            sourceUrl: string;
            sourceTitle: string;
            excerpt: string;
            confidence: number;
        }[];
        scoreBreakdown: {
            score: number;
            category: string;
            components: Record<string, number>;
            explanation: string[];
        };
        gridContext: {
            sourceUrl: string | null;
            level: string;
            source: string;
            notes: string | null;
        } | null;
        uncertainty: string[];
        whatWeDoNotKnow: string[];
        missingInformation: string[];
    }>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    updatedAt: string;
    opportunityId: string;
    content: {
        recommendedNextStep: string;
        company: {
            name: string;
            address: string | null;
            city: string | null;
        };
        signal: {
            type: string;
            confidence: number;
            description: string;
            estimatedImpactClass: string;
        };
        evidence: {
            publishedAt: string | null;
            sourceUrl: string;
            sourceTitle: string;
            excerpt: string;
            confidence: number;
        }[];
        scoreBreakdown: {
            score: number;
            category: string;
            components: Record<string, number>;
            explanation: string[];
        };
        gridContext: {
            sourceUrl: string | null;
            level: string;
            source: string;
            notes: string | null;
        } | null;
        uncertainty: string[];
        whatWeDoNotKnow: string[];
        missingInformation: string[];
    };
}, {
    id: string;
    createdAt: string;
    updatedAt: string;
    opportunityId: string;
    content: {
        recommendedNextStep: string;
        company: {
            name: string;
            address: string | null;
            city: string | null;
        };
        signal: {
            type: string;
            confidence: number;
            description: string;
            estimatedImpactClass: string;
        };
        evidence: {
            publishedAt: string | null;
            sourceUrl: string;
            sourceTitle: string;
            excerpt: string;
            confidence: number;
        }[];
        scoreBreakdown: {
            score: number;
            category: string;
            components: Record<string, number>;
            explanation: string[];
        };
        gridContext: {
            sourceUrl: string | null;
            level: string;
            source: string;
            notes: string | null;
        } | null;
        uncertainty: string[];
        whatWeDoNotKnow: string[];
        missingInformation: string[];
    };
}>;
export type Dossier = z.infer<typeof DossierSchema>;
export declare const QueueStatus: z.ZodEnum<["pending", "dispatched", "cancelled", "failed"]>;
export type QueueStatus = z.infer<typeof QueueStatus>;
export declare const QueuedActionSchema: z.ZodObject<{
    id: z.ZodString;
    opportunityId: z.ZodString;
    actionType: z.ZodString;
    status: z.ZodEnum<["pending", "dispatched", "cancelled", "failed"]>;
    attempts: z.ZodNumber;
    reason: z.ZodString;
    metadata: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    lastError: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    dispatchedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "dispatched" | "cancelled" | "failed";
    id: string;
    createdAt: string;
    updatedAt: string;
    opportunityId: string;
    reason: string;
    metadata: Record<string, unknown> | null;
    actionType: string;
    attempts: number;
    lastError: string | null;
    dispatchedAt: string | null;
}, {
    status: "pending" | "dispatched" | "cancelled" | "failed";
    id: string;
    createdAt: string;
    updatedAt: string;
    opportunityId: string;
    reason: string;
    metadata: Record<string, unknown> | null;
    actionType: string;
    attempts: number;
    lastError: string | null;
    dispatchedAt: string | null;
}>;
export type QueuedAction = z.infer<typeof QueuedActionSchema>;
