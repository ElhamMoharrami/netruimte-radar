import {
  QueuedActionSchema,
  type ActionQueueRepository,
  type QueuedAction,
} from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  opportunity_id: string;
  action_type: string;
  status: string;
  attempts: number;
  reason: string;
  metadata: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
}

function toDomain(row: Row): QueuedAction {
  return QueuedActionSchema.parse({
    id: row.id,
    opportunityId: row.opportunity_id,
    actionType: row.action_type,
    status: row.status,
    attempts: row.attempts,
    reason: row.reason,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dispatchedAt: row.dispatched_at,
  });
}

export function createActionQueueRepository(db: Db): ActionQueueRepository {
  const enqueueStmt = db.prepare(`
    INSERT INTO action_queue (
      id, opportunity_id, action_type, status, attempts, reason, metadata,
      last_error, created_at, updated_at, dispatched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE action_queue SET
      action_type=?, status=?, attempts=?, reason=?, metadata=?,
      last_error=?, updated_at=?, dispatched_at=?
    WHERE id=?
  `);
  const byId = db.prepare(`SELECT * FROM action_queue WHERE id = ?`);
  const byOpp = db.prepare(
    `SELECT * FROM action_queue WHERE opportunity_id = ? ORDER BY created_at ASC`,
  );
  const byStatus = db.prepare(
    `SELECT * FROM action_queue WHERE status = ? ORDER BY created_at ASC`,
  );

  return {
    async enqueue(action) {
      const a = QueuedActionSchema.parse(action);
      enqueueStmt.run(
        a.id,
        a.opportunityId,
        a.actionType,
        a.status,
        a.attempts,
        a.reason,
        a.metadata ? JSON.stringify(a.metadata) : null,
        a.lastError,
        a.createdAt,
        a.updatedAt,
        a.dispatchedAt,
      );
      return a;
    },
    async update(action) {
      const a = QueuedActionSchema.parse(action);
      updateStmt.run(
        a.actionType,
        a.status,
        a.attempts,
        a.reason,
        a.metadata ? JSON.stringify(a.metadata) : null,
        a.lastError,
        a.updatedAt,
        a.dispatchedAt,
        a.id,
      );
      return a;
    },
    async findById(id) {
      const row = byId.get(id) as unknown as Row | undefined;
      return row ? toDomain(row) : null;
    },
    async listByOpportunity(opportunityId) {
      const rows = byOpp.all(opportunityId) as unknown as Row[];
      return rows.map(toDomain);
    },
    async listByStatus(status) {
      const rows = byStatus.all(status) as unknown as Row[];
      return rows.map(toDomain);
    },
  };
}
