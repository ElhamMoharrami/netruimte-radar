import {
  ActivityLogSchema,
  type ActivityLog,
  type ActivityLogRepository,
} from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  opportunity_id: string | null;
  event_type: string;
  message: string;
  metadata: string | null;
  created_at: string;
}

function toDomain(row: Row): ActivityLog {
  return ActivityLogSchema.parse({
    id: row.id,
    opportunityId: row.opportunity_id,
    eventType: row.event_type,
    message: row.message,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
  });
}

export function createActivityLogRepository(db: Db): ActivityLogRepository {
  const insertStmt = db.prepare(`
    INSERT INTO activity_log (id, opportunity_id, event_type, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const byOpp = db.prepare(`SELECT * FROM activity_log WHERE opportunity_id = ? ORDER BY created_at ASC`);
  const recent = db.prepare(`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?`);

  return {
    async append(log) {
      const l = ActivityLogSchema.parse(log);
      insertStmt.run(
        l.id,
        l.opportunityId,
        l.eventType,
        l.message,
        l.metadata ? JSON.stringify(l.metadata) : null,
        l.createdAt,
      );
      return l;
    },
    async listByOpportunity(opportunityId) {
      const rows = byOpp.all(opportunityId) as unknown as Row[];
      return rows.map(toDomain);
    },
    async listRecent(limit = 100) {
      const rows = recent.all(limit) as unknown as Row[];
      return rows.map(toDomain);
    },
  };
}
