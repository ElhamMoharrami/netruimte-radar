/**
 * SQL schema for the local SQLite store. Kept intentionally small — one table
 * per entity, JSON columns for the array/object fields that would otherwise
 * require join tables. This keeps repositories trivial while still being easy
 * to port to D1/Postgres later.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  address TEXT,
  city TEXT,
  latitude REAL,
  longitude REAL,
  sector TEXT,
  source_urls TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  published_at TEXT,
  raw_text_hash TEXT NOT NULL,
  confidence REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_company ON evidence(company_id);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  evidence_ids TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_impact_class TEXT NOT NULL,
  confidence REAL NOT NULL,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(company_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  signal_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  congestion_context TEXT,
  grid_neighbor_status TEXT NOT NULL,
  recommended_next_step TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opps_company ON opportunities(company_id);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  decision_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_opp ON decisions(opportunity_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_opp ON activity_log(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS run_history (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  extractor TEXT NOT NULL,
  automation_provider TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  sources_discovered INTEGER NOT NULL,
  companies_processed INTEGER NOT NULL,
  signals_detected INTEGER NOT NULL,
  opportunities_created INTEGER NOT NULL,
  actions_dispatched INTEGER NOT NULL,
  actions_blocked INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  incomplete INTEGER NOT NULL DEFAULT 0,
  decisions TEXT NOT NULL DEFAULT '{}',
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON run_history(started_at);

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL UNIQUE REFERENCES opportunities(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_queue (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  metadata TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_opp ON action_queue(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_queue_status ON action_queue(status);

CREATE TABLE IF NOT EXISTS grid_events (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  event_type TEXT NOT NULL,
  regions TEXT NOT NULL DEFAULT '[]',
  municipalities TEXT NOT NULL DEFAULT '[]',
  stations TEXT NOT NULL DEFAULT '[]',
  direction TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_excerpt TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_at TEXT,
  detected_at TEXT NOT NULL,
  confidence REAL NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(source_url, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_grid_events_source ON grid_events(source_url);
CREATE INDEX IF NOT EXISTS idx_grid_events_detected ON grid_events(detected_at);
`;
