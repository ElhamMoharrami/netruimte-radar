import type { ActivityLog, Company, Decision, Dossier, Evidence, Opportunity, QueuedAction, QueueStatus, RunHistory, Signal } from './domain.js';
export interface CompanyRepository {
    upsert(company: Company): Promise<Company>;
    findById(id: string): Promise<Company | null>;
    findByName(name: string): Promise<Company | null>;
    list(): Promise<Company[]>;
}
export interface EvidenceRepository {
    insert(evidence: Evidence): Promise<Evidence>;
    findById(id: string): Promise<Evidence | null>;
    listByCompany(companyId: string): Promise<Evidence[]>;
}
export interface SignalRepository {
    insert(signal: Signal): Promise<Signal>;
    findById(id: string): Promise<Signal | null>;
    listByCompany(companyId: string): Promise<Signal[]>;
}
export interface OpportunityRepository {
    insert(opportunity: Opportunity): Promise<Opportunity>;
    update(opportunity: Opportunity): Promise<Opportunity>;
    findById(id: string): Promise<Opportunity | null>;
    findByCompany(companyId: string): Promise<Opportunity[]>;
    list(): Promise<Opportunity[]>;
}
export interface DecisionRepository {
    insert(decision: Decision): Promise<Decision>;
    listByOpportunity(opportunityId: string): Promise<Decision[]>;
}
export interface ActivityLogRepository {
    append(log: ActivityLog): Promise<ActivityLog>;
    listByOpportunity(opportunityId: string): Promise<ActivityLog[]>;
    listRecent(limit?: number): Promise<ActivityLog[]>;
}
export interface RunHistoryRepository {
    insert(run: RunHistory): Promise<RunHistory>;
    list(limit?: number): Promise<RunHistory[]>;
    findById(id: string): Promise<RunHistory | null>;
}
export interface DossierRepository {
    upsert(dossier: Dossier): Promise<Dossier>;
    findByOpportunity(opportunityId: string): Promise<Dossier | null>;
}
export interface ActionQueueRepository {
    enqueue(action: QueuedAction): Promise<QueuedAction>;
    update(action: QueuedAction): Promise<QueuedAction>;
    findById(id: string): Promise<QueuedAction | null>;
    listByOpportunity(opportunityId: string): Promise<QueuedAction[]>;
    listByStatus(status: QueueStatus): Promise<QueuedAction[]>;
}
export interface Repositories {
    companies: CompanyRepository;
    evidence: EvidenceRepository;
    signals: SignalRepository;
    opportunities: OpportunityRepository;
    decisions: DecisionRepository;
    activity: ActivityLogRepository;
    runs: RunHistoryRepository;
    dossiers: DossierRepository;
    actionQueue: ActionQueueRepository;
}
