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

const INSERT_SQL = `
  INSERT INTO activity_log (id, opportunity_id, event_type, message, metadata, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`;

export function createActivityLogRepository(db: Db): ActivityLogRepository {
  return {
    async append(log) {
      const l = ActivityLogSchema.parse(log);
      await db.execute(INSERT_SQL, [
        l.id,
        l.opportunityId,
        l.eventType,
        l.message,
        l.metadata ? JSON.stringify(l.metadata) : null,
        l.createdAt,
      ]);
      return l;
    },
    async listByOpportunity(opportunityId) {
      const rows = await db.all<Row>(
        `SELECT * FROM activity_log WHERE opportunity_id = ? ORDER BY created_at ASC`,
        [opportunityId],
      );
      return rows.map(toDomain);
    },
    async listRecent(limit = 100) {
      const rows = await db.all<Row>(
        `SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?`,
        [limit],
      );
      return rows.map(toDomain);
    },
  };
}
