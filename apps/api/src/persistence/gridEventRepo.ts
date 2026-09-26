import {
  GridEventSchema,
  type GridEvent,
  type GridEventRepository,
} from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  operator: string;
  event_type: string;
  regions: string;
  municipalities: string;
  stations: string;
  direction: string;
  summary: string;
  evidence_excerpt: string;
  source_url: string;
  published_at: string | null;
  detected_at: string;
  confidence: number;
  content_hash: string;
}

function toDomain(row: Row): GridEvent {
  return GridEventSchema.parse({
    id: row.id,
    operator: row.operator,
    eventType: row.event_type,
    regions: JSON.parse(row.regions) as string[],
    municipalities: JSON.parse(row.municipalities) as string[],
    stations: JSON.parse(row.stations) as string[],
    direction: row.direction,
    summary: row.summary,
    evidenceExcerpt: row.evidence_excerpt,
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    detectedAt: row.detected_at,
    confidence: row.confidence,
    contentHash: row.content_hash,
  });
}

export function createGridEventRepository(db: Db): GridEventRepository {
  const insertStmt = db.prepare(`
    INSERT INTO grid_events (
      id, operator, event_type, regions, municipalities, stations,
      direction, summary, evidence_excerpt, source_url,
      published_at, detected_at, confidence, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.prepare(`SELECT * FROM grid_events WHERE id = ?`);
  const byUrl = db.prepare(
    `SELECT * FROM grid_events WHERE source_url = ? ORDER BY detected_at DESC LIMIT 1`,
  );
  const byUrlAndHash = db.prepare(
    `SELECT * FROM grid_events WHERE source_url = ? AND content_hash = ? LIMIT 1`,
  );
  const listStmt = db.prepare(`SELECT * FROM grid_events ORDER BY detected_at DESC LIMIT ?`);

  return {
    async insert(event) {
      const e = GridEventSchema.parse(event);
      insertStmt.run(
        e.id,
        e.operator,
        e.eventType,
        JSON.stringify(e.regions),
        JSON.stringify(e.municipalities),
        JSON.stringify(e.stations),
        e.direction,
        e.summary,
        e.evidenceExcerpt,
        e.sourceUrl,
        e.publishedAt,
        e.detectedAt,
        e.confidence,
        e.contentHash,
      );
      return e;
    },
    async findById(id) {
      const row = byId.get(id) as unknown as Row | undefined;
      return row ? toDomain(row) : null;
    },
    async findLatestBySourceUrl(sourceUrl) {
      const row = byUrl.get(sourceUrl) as unknown as Row | undefined;
      return row ? toDomain(row) : null;
    },
    async findBySourceAndHash(sourceUrl, contentHash) {
      const row = byUrlAndHash.get(sourceUrl, contentHash) as unknown as Row | undefined;
      return row ? toDomain(row) : null;
    },
    async list(limit = 100) {
      const rows = listStmt.all(limit) as unknown as Row[];
      return rows.map(toDomain);
    },
  };
}
