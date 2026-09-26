import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { newId, type Repositories } from '@netruimte/shared';
import {
  ApifySourceDiscoveryProvider,
  AutonomousRunService,
  DemoGridContextProvider,
  DemoSourceDiscoveryProvider,
  DisabledAutomationProvider,
  LocalAutomationProvider,
  N8nAutomationClient,
  NETBEHEER_NL_SNAPSHOT_AT,
  NetbeheerNlGridContextProvider,
  OpportunityDossierService,
  PolicyEngine,
  OpportunityScoringService,
  RuleBasedEvidenceExtractor,
  chooseEvidenceExtractor,
  type AiProvider,
  type AutomationProvider,
  type EvidenceExtractor,
  type GridContextProvider,
  type SourceDiscoveryProvider,
} from '@netruimte/core';
import { openDb, openLibsqlDb, createRepositories, type Db } from './persistence/index.js';

export interface AppContext {
  repos: Repositories;
  demoMode: boolean;
  serviceToken: string | null;
  sources: SourceDiscoveryProvider;
  extractor: EvidenceExtractor;
  grid: GridContextProvider;
  automation: AutomationProvider;
  runService: AutonomousRunService;
  dossierService: OpportunityDossierService;
  wiring: WiringReport;
  /** Build a demo-provider variant of this context (V9 offline mode). */
  buildOfflineRunService(): AutonomousRunService;
  /** Wipe every row in every table. Only exposed for demo controls. */
  resetDb(): Promise<void>;
}

export type GridProvider = 'demo' | 'netbeheer-nl';
export type DatabaseProvider = 'sqlite' | 'turso';

export interface WiringReport {
  demoMode: boolean;
  extractor: string;
  extractorReason: string;
  aiProvider: AiProvider;
  sourceProvider: string;
  sourceProviderReason: string;
  automationProvider: string;
  automationProviderReason: string;
  gridProvider: GridProvider;
  gridProviderReason: string;
  databaseProvider: DatabaseProvider;
  databaseProviderReason: string;
  notificationAllowlist: number;
  scheduledEndpointEnabled: boolean;
}

export interface CreateContextOptions {
  sqlitePath?: string;
  demoMode?: boolean;
  /** Injected in tests to override provider selection. */
  overrides?: {
    sources?: SourceDiscoveryProvider;
    extractor?: EvidenceExtractor;
    grid?: GridContextProvider;
    automation?: AutomationProvider;
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const DEMO_SOURCES_DIR = resolve(here, '../../../data/demo/sources');

export async function createContext(opts: CreateContextOptions = {}): Promise<AppContext> {
  const demoMode = opts.demoMode ?? (process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true';
  const serviceToken = process.env.SERVICE_TOKEN?.trim() || null;
  const notificationAllowlist = parseAllowlist(process.env.NOTIFICATION_ALLOWLIST);

  // --- Database ------------------------------------------------------------
  // Selection order:
  //   1. DATABASE_PROVIDER env var (explicit).
  //   2. Auto: presence of TURSO_DATABASE_URL → turso, else sqlite.
  // The libsql adapter is required in production on Netlify Functions because
  // each invocation gets its own container — an in-memory node:sqlite db can
  // hold a scan's output but the very next request lands on a different
  // instance and sees an empty DB.
  const providerEnv = process.env.DATABASE_PROVIDER?.trim().toLowerCase();
  const wantsTurso =
    providerEnv === 'turso' ||
    (providerEnv === undefined && Boolean(process.env.TURSO_DATABASE_URL));
  let db: Db;
  let databaseProvider: DatabaseProvider;
  let databaseProviderReason: string;
  if (wantsTurso) {
    const url = process.env.TURSO_DATABASE_URL?.trim();
    if (!url) {
      throw new Error(
        'DATABASE_PROVIDER=turso but TURSO_DATABASE_URL is not set. Configure a libsql:// URL from the Turso dashboard.',
      );
    }
    db = await openLibsqlDb({ url, authToken: process.env.TURSO_AUTH_TOKEN?.trim() });
    databaseProvider = 'turso';
    databaseProviderReason = providerEnv
      ? 'DATABASE_PROVIDER=turso'
      : 'auto — TURSO_DATABASE_URL present';
  } else {
    const sqlitePath = opts.sqlitePath ?? process.env.SQLITE_PATH ?? ':memory:';
    db = openDb({ path: sqlitePath });
    databaseProvider = 'sqlite';
    databaseProviderReason = providerEnv
      ? `DATABASE_PROVIDER=sqlite (path=${sqlitePath})`
      : `auto — no TURSO_DATABASE_URL (path=${sqlitePath})`;
  }
  const repos = createRepositories(db);

  const wiring: WiringReport = {
    demoMode,
    extractor: '',
    extractorReason: '',
    aiProvider: 'rules',
    sourceProvider: '',
    sourceProviderReason: '',
    automationProvider: '',
    automationProviderReason: '',
    gridProvider: 'demo',
    gridProviderReason: '',
    databaseProvider,
    databaseProviderReason,
    notificationAllowlist: notificationAllowlist.length,
    scheduledEndpointEnabled: Boolean(serviceToken),
  };

  // --- Sources -------------------------------------------------------------
  let sources: SourceDiscoveryProvider;
  if (opts.overrides?.sources) {
    sources = opts.overrides.sources;
    wiring.sourceProvider = sources.name;
    wiring.sourceProviderReason = 'test override';
  } else if (process.env.APIFY_TOKEN && (process.env.APIFY_ACTOR_ID || process.env.APIFY_DATASET_ID)) {
    const startUrls = parseStartUrls(process.env.APIFY_START_URLS);
    const actorInput = parseActorInput(process.env.APIFY_ACTOR_INPUT);
    sources = new ApifySourceDiscoveryProvider({
      token: process.env.APIFY_TOKEN,
      actorId: process.env.APIFY_ACTOR_ID ?? '',
      datasetId: process.env.APIFY_DATASET_ID ?? undefined,
      startUrls,
      actorInput,
      onEvent: (event, meta) => {
        // Non-blocking best-effort diagnostic write. Never blocks discovery.
        void repos.activity
          .append({
            id: newId.activity(),
            opportunityId: null,
            eventType:
              event === 'apify.error'
                ? 'RETRY_FAILED'
                : event === 'apify.run.terminal'
                  ? 'SOURCE_DISCOVERED'
                  : 'SCAN_STARTED',
            message: `[apify] ${event}`,
            metadata: { ...meta, event },
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      },
    });
    wiring.sourceProvider = 'apify';
    wiring.sourceProviderReason = [
      'APIFY_TOKEN + actor/dataset id present',
      actorInput
        ? 'input=APIFY_ACTOR_INPUT (raw JSON)'
        : startUrls.length > 0
          ? `input=APIFY_START_URLS (${startUrls.length} url${startUrls.length === 1 ? '' : 's'})`
          : 'input=empty (no APIFY_START_URLS or APIFY_ACTOR_INPUT set — actor will run with empty input)',
    ].join('; ');
  } else {
    if (!demoMode) {
      throw new Error(
        'No source provider configured. Set APIFY_TOKEN + APIFY_ACTOR_ID or run with DEMO_MODE=true.',
      );
    }
    sources = new DemoSourceDiscoveryProvider(DEMO_SOURCES_DIR);
    wiring.sourceProvider = 'demo';
    wiring.sourceProviderReason = 'DEMO_MODE=true, no Apify credentials';
  }

  // --- Evidence extractor --------------------------------------------------
  let extractor: EvidenceExtractor;
  if (opts.overrides?.extractor) {
    extractor = opts.overrides.extractor;
    wiring.extractor = extractor.name;
    wiring.extractorReason = 'test override';
    wiring.aiProvider = 'rules';
  } else {
    const selection = chooseEvidenceExtractor({
      env: {
        AI_PROVIDER: process.env.AI_PROVIDER,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_MODEL: process.env.OPENAI_MODEL,
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GEMINI_MODEL: process.env.GEMINI_MODEL,
      },
      onFallback: (err, source) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[extractor] AI provider failed on ${source.url} — falling back to rule-based:`,
          (err as Error).message,
        );
      },
    });
    extractor = selection.extractor;
    wiring.extractor = selection.providerName;
    wiring.extractorReason = selection.reason;
    wiring.aiProvider = selection.aiProvider;
  }

  // --- Grid context --------------------------------------------------------
  let grid: GridContextProvider;
  if (opts.overrides?.grid) {
    grid = opts.overrides.grid;
    wiring.gridProvider = (grid.name === 'netbeheer-nl' ? 'netbeheer-nl' : 'demo') as GridProvider;
    wiring.gridProviderReason = 'test override';
  } else {
    const gridPreference = (process.env.GRID_PROVIDER ?? 'auto').trim().toLowerCase();
    if (gridPreference === 'demo') {
      grid = new DemoGridContextProvider();
      wiring.gridProvider = 'demo';
      wiring.gridProviderReason = 'GRID_PROVIDER=demo — static city table';
    } else if (gridPreference === 'netbeheer-nl' || gridPreference === 'nbnl') {
      grid = new NetbeheerNlGridContextProvider();
      wiring.gridProvider = 'netbeheer-nl';
      wiring.gridProviderReason = `GRID_PROVIDER=netbeheer-nl — live PDOK geocoding + Netbeheer NL snapshot (${NETBEHEER_NL_SNAPSHOT_AT})`;
    } else {
      // auto: prefer real data when not in demo mode, fall back to demo table
      // when demo mode is on so /demo/reset + /demo/overnight-scan stay
      // deterministic.
      if (demoMode) {
        grid = new DemoGridContextProvider();
        wiring.gridProvider = 'demo';
        wiring.gridProviderReason = 'DEMO_MODE=true — using deterministic demo table';
      } else {
        grid = new NetbeheerNlGridContextProvider();
        wiring.gridProvider = 'netbeheer-nl';
        wiring.gridProviderReason = `auto — live PDOK geocoding + Netbeheer NL snapshot (${NETBEHEER_NL_SNAPSHOT_AT})`;
      }
    }
  }

  // --- Automation ----------------------------------------------------------
  let automation: AutomationProvider;
  if (opts.overrides?.automation) {
    automation = opts.overrides.automation;
    wiring.automationProvider = automation.name;
    wiring.automationProviderReason = 'test override';
  } else if (process.env.N8N_BASE_URL) {
    automation = new N8nAutomationClient({
      baseUrl: process.env.N8N_BASE_URL,
      webhookToken: process.env.N8N_WEBHOOK_TOKEN,
      notificationAllowlist,
    });
    wiring.automationProvider = 'n8n';
    wiring.automationProviderReason = `N8N_BASE_URL present, allowlist=${notificationAllowlist.length}`;
  } else if (demoMode) {
    automation = new LocalAutomationProvider();
    wiring.automationProvider = 'local';
    wiring.automationProviderReason = 'DEMO_MODE=true, no N8N_BASE_URL';
  } else {
    automation = new DisabledAutomationProvider();
    wiring.automationProvider = 'disabled';
    wiring.automationProviderReason = 'no automation provider configured';
  }

  const runService = new AutonomousRunService({
    repos,
    sources,
    extractor,
    grid,
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation,
  });

  const dossierService = new OpportunityDossierService(repos);

  const buildOfflineRunService = () => {
    // Always uses demo providers + local automation, regardless of env.
    const offlineSources = new DemoSourceDiscoveryProvider(DEMO_SOURCES_DIR);
    const offlineAutomation = new LocalAutomationProvider();
    return new AutonomousRunService({
      repos,
      sources: offlineSources,
      extractor: new RuleBasedEvidenceExtractor(),
      grid: new DemoGridContextProvider(),
      scoring: new OpportunityScoringService(),
      policy: new PolicyEngine(),
      automation: offlineAutomation,
    });
  };

  return {
    repos,
    demoMode,
    serviceToken,
    sources,
    extractor,
    grid,
    automation,
    runService,
    dossierService,
    wiring,
    buildOfflineRunService,
    resetDb: () => resetDb(db),
  };
}

async function resetDb(db: Db): Promise<void> {
  // libsql doesn't guarantee multi-statement execution semantics on plain
  // execute(), so issue each DELETE individually. Order matters for the
  // FK constraints in schema.ts.
  const tables = [
    'action_queue',
    'decisions',
    'activity_log',
    'dossiers',
    'run_history',
    'opportunities',
    'signals',
    'evidence',
    'grid_events',
    'companies',
  ];
  for (const t of tables) {
    await db.execute(`DELETE FROM ${t}`);
  }
}

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseStartUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseActorInput(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // eslint-disable-next-line no-console
    console.warn('[context] APIFY_ACTOR_INPUT must be a JSON object; ignoring');
    return undefined;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[context] APIFY_ACTOR_INPUT is not valid JSON; ignoring:', (err as Error).message);
    return undefined;
  }
}
