export interface WiringReport {
  demoMode: boolean;
  extractor: string;
  extractorReason: string;
  aiProvider: 'rules' | 'anthropic' | 'openai' | 'gemini';
  sourceProvider: string;
  sourceProviderReason: string;
  automationProvider: string;
  automationProviderReason: string;
  gridProvider: 'demo' | 'netbeheer-nl';
  gridProviderReason: string;
  notificationAllowlist: number;
  scheduledEndpointEnabled: boolean;
}

export interface OpportunitySummary {
  id: string;
  companyId: string;
  signalIds: string[];
  status: string;
  score: number;
  confidence: number;
  congestionContext: {
    level: string;
    source: string;
    sourceUrl: string | null;
    checkedAt: string;
    notes: string | null;
  } | null;
  gridNeighborStatus: string;
  recommendedNextStep: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  website: string | null;
  sourceUrls: string[];
}

export interface SignalDto {
  id: string;
  type: string;
  description: string;
  estimatedImpactClass: string;
  confidence: number;
  detectedAt: string;
  evidenceIds: string[];
}

export interface EvidenceDto {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: string;
  excerpt: string;
  detectedAt: string;
  publishedAt: string | null;
  confidence: number;
}

export interface DecisionDto {
  id: string;
  decisionType: string;
  reason: string;
  policyVersion: string;
  createdAt: string;
}

export interface OpportunityDetail {
  opportunity: OpportunitySummary;
  company: CompanyDto | null;
  signals: SignalDto[];
  evidence: EvidenceDto[];
  decisions: DecisionDto[];
}

export interface ActivityEntry {
  id: string;
  opportunityId: string | null;
  eventType: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DossierContentDto {
  company: { name: string; city: string | null; address: string | null };
  signal: { type: string; description: string; estimatedImpactClass: string; confidence: number };
  evidence: Array<{
    sourceUrl: string;
    sourceTitle: string;
    excerpt: string;
    publishedAt: string | null;
    confidence: number;
  }>;
  scoreBreakdown: {
    score: number;
    category: string;
    components: Record<string, number>;
    explanation: string[];
  };
  gridContext: {
    level: string;
    source: string;
    sourceUrl: string | null;
    notes: string | null;
  } | null;
  uncertainty: string[];
  whatWeDoNotKnow: string[];
  missingInformation: string[];
  recommendedNextStep: string;
}

export interface DossierDto {
  id: string;
  opportunityId: string;
  content: DossierContentDto;
  createdAt: string;
  updatedAt: string;
}

export interface RunHistoryDto {
  id: string;
  trigger: 'manual' | 'scheduled' | 'demo';
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
  notes: string | null;
}

export interface RunSummaryDto {
  runId: string;
  trigger: string;
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
  decisions: Record<string, number>;
  actionsDispatched: number;
  actionsBlocked: number;
  actionsCancelled: number;
  failures: number;
  incomplete: boolean;
  notes: string | null;
}

export interface RunResponse {
  wiring: WiringReport;
  summary: RunSummaryDto;
}

export interface HistoryResponse {
  opportunityId: string;
  decisions: DecisionDto[];
  reassessments: Array<{
    at: string;
    message: string;
    conflict?: boolean;
    priorScore?: number;
    newScore?: number;
    priorDecision?: string | null;
    newDecision?: string;
    triggeringEvidenceId?: string;
    triggeringSourceUrl?: string;
    reason?: string;
  }>;
}

// Global offline flag — set from URL query param on module load.
let offlineFlag = false;
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  offlineFlag = params.get('offline') === 'true';
}
export function isOffline(): boolean {
  return offlineFlag;
}
function withOffline(url: string): string {
  if (!offlineFlag) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}offline=true`;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withOffline(url), init);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  wiring: () => jsonFetch<WiringReport>('/api/wiring'),
  opportunities: () =>
    jsonFetch<{ data: OpportunitySummary[] }>('/api/opportunities').then((r) => r.data),
  opportunity: (id: string) => jsonFetch<OpportunityDetail>(`/api/opportunities/${id}`),
  activityFor: (id: string) =>
    jsonFetch<{ activity: ActivityEntry[] }>(`/api/opportunities/${id}/activity`).then(
      (r) => r.activity,
    ),
  dossier: (id: string) =>
    jsonFetch<{ dossier: DossierDto }>(`/api/opportunities/${id}/dossier`).then((r) => r.dossier),
  history: (id: string) => jsonFetch<HistoryResponse>(`/api/opportunities/${id}/history`),
  recentActivity: (limit = 50) =>
    jsonFetch<{ data: ActivityEntry[] }>(`/api/activity/recent?limit=${limit}`).then(
      (r) => r.data,
    ),
  runDemo: () => jsonFetch<RunResponse>('/api/runs/demo', { method: 'POST' }),
  runs: (limit = 50) =>
    jsonFetch<{ data: RunHistoryDto[] }>(`/api/runs?limit=${limit}`).then((r) => r.data),
  demo: {
    reset: () => jsonFetch<{ ok: true }>('/api/demo/reset', { method: 'POST' }),
    overnightScan: () =>
      jsonFetch<{ summary: RunSummaryDto }>('/api/demo/overnight-scan', { method: 'POST' }),
    injectConflict: (opportunityId: string) =>
      jsonFetch<{ summary: RunSummaryDto }>(
        `/api/demo/inject-conflict/${encodeURIComponent(opportunityId)}`,
        { method: 'POST' },
      ),
    simulateApifyFail: () =>
      jsonFetch<{ summary: RunSummaryDto }>('/api/demo/simulate/apify-fail', { method: 'POST' }),
    simulateN8nFail: () =>
      jsonFetch<{ summary: RunSummaryDto }>('/api/demo/simulate/n8n-fail', { method: 'POST' }),
  },
};
