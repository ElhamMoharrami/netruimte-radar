import { EvidenceSchema, type Evidence, type EvidenceRepository } from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  company_id: string;
  source_url: string;
  source_title: string;
  source_type: string;
  excerpt: string;
  detected_at: string;
  published_at: string | null;
  raw_text_hash: string;
  confidence: number;
}

function toDomain(row: Row): Evidence {
  return EvidenceSchema.parse({
    id: row.id,
    companyId: row.company_id,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    sourceType: row.source_type,
    excerpt: row.excerpt,
    detectedAt: row.detected_at,
    publishedAt: row.published_at,
    rawTextHash: row.raw_text_hash,
    confidence: row.confidence,
  });
}

export function createEvidenceRepository(db: Db): EvidenceRepository {
  const insertStmt = db.prepare(`
    INSERT INTO evidence (id, company_id, source_url, source_title, source_type, excerpt, detected_at, published_at, raw_text_hash, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.prepare(`SELECT * FROM evidence WHERE id = ?`);
  const byCompany = db.prepare(`SELECT * FROM evidence WHERE company_id = ? ORDER BY detected_at DESC`);

  return {
    async insert(evidence) {
      const e = EvidenceSchema.parse(evidence);
      insertStmt.run(
        e.id,
        e.companyId,
        e.sourceUrl,
        e.sourceTitle,
        e.sourceType,
        e.excerpt,
        e.detectedAt,
        e.publishedAt,
        e.rawTextHash,
        e.confidence,
      );
      return e;
    },
    async findById(id) {
      const row = byId.get(id) as unknown as Row | undefined;
      return row ? toDomain(row) : null;
    },
    async listByCompany(companyId) {
      const rows = byCompany.all(companyId) as unknown as Row[];
      return rows.map(toDomain);
    },
  };
}
