import {
  RunHistorySchema,
  type RunHistory,
  type RunHistoryRepository,
} from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  trigger: string;
  source_provider: string;
  extractor: string;
  automation_provider: string;
  started_at: string;
  finished_at: string;
  sources_discovered: number;
  companies_processed: number;
  signals_detected: number;
  opportunities_created: number;
  actions_dispatched: number;
  actions_blocked: number;
  failures: number;
  incomplete: number;
  decisions: string;
  notes: string | null;
}

function toDomain(row: Row): RunHistory {
  return RunHistorySchema.parse({
    id: row.id,
    trigger: row.trigger,
    sourceProvider: row.source_provider,
    extractor: row.extractor,
    automationProvider: row.automation_provider,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourcesDiscovered: row.sources_discovered,
    companiesProcessed: row.companies_processed,
    signalsDetected: row.signals_detected,
    opportunitiesCreated: row.opportunities_created,
    actionsDispatched: row.actions_dispatched,
    actionsBlocked: row.actions_blocked,
    failures: row.failures,
    incomplete: Boolean(row.incomplete),
    decisions: JSON.parse(row.decisions) as Record<string, number>,
    notes: row.notes,
  });
}

export function createRunHistoryRepository(db: Db): RunHistoryRepository {
  const insertStmt = db.prepare(`
    INSERT INTO run_history (
      id, trigger, source_provider, extractor, automation_provider,
      started_at, finished_at,
      sources_discovered, companies_processed, signals_detected,
      opportunities_created, actions_dispatched, actions_blocked,
      failures, incomplete, decisions, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.prepare(`SELECT * FROM run_history WHERE id = ?`);
  const listStmt = db.prepare(`SELECT * FROM run_history ORDER BY started_at DESC LIMIT ?`);

  return {
    async insert(run) {
      const r = RunHistorySchema.parse(run);
      insertStmt.run(
        r.id,
        r.trigger,
        r.sourceProvider,
        r.extractor,
        r.automationProvider,
        r.startedAt,
        r.finishedAt,
        r.sourcesDiscovered,
        r.companiesProcessed,
        r.signalsDetected,
        r.opportunitiesCreated,
        r.actionsDispatched,
        r.actionsBlocked,
        r.failures,
        r.incomplete ? 1 : 0,
        JSON.stringify(r.decisions),
        r.notes,
      );
      return r;
    },
    async findById(id) {
      const row = byId.get(id) as unknown as Row | undefined;
      return row ? toDomain(row) : null;
    },
    async list(limit = 100) {
      const rows = listStmt.all(limit) as unknown as Row[];
      return rows.map(toDomain);
    },
  };
}
