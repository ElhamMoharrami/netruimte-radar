import type {
  ActivityLog,
  Company,
  Decision,
  Dossier,
  Evidence,
  GridEvent,
  Opportunity,
  QueuedAction,
  QueueStatus,
  RunHistory,
  Signal,
} from './domain.js';

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
  /**
   * Exact-match dedupe lookup used by the business_signal pre-extraction
   * guard. `sourceUrl` MUST already be canonicalized by the caller (see
   * `@netruimte/core` → `canonicalizeUrl`); this repo does not normalize
   * for you.
   */
  findBySourceAndHash(sourceUrl: string, rawTextHash: string): Promise<Evidence | null>;
  /**
   * Returns any prior evidence row for this canonical URL — used to
   * distinguish first-time processing from a genuine content-changed
   * re-scan. Returns the most recently detected row when several exist.
   */
  findAnyBySourceUrl(sourceUrl: string): Promise<Evidence | null>;
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

export interface GridEventRepository {
  insert(event: GridEvent): Promise<GridEvent>;
  findById(id: string): Promise<GridEvent | null>;
  /** Latest event for a given source URL, or null. Used by the dedup check. */
  findLatestBySourceUrl(sourceUrl: string): Promise<GridEvent | null>;
  /** Same-content check — returns the previously-persisted event when
   *  (sourceUrl, contentHash) already exists. Enables O(1) UNCHANGED lookup. */
  findBySourceAndHash(sourceUrl: string, contentHash: string): Promise<GridEvent | null>;
  list(limit?: number): Promise<GridEvent[]>;
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
  gridEvents: GridEventRepository;
}
