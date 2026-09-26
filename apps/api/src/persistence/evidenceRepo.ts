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

const INSERT_SQL = `
  INSERT INTO evidence (id, company_id, source_url, source_title, source_type, excerpt, detected_at, published_at, raw_text_hash, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function createEvidenceRepository(db: Db): EvidenceRepository {
  return {
    async insert(evidence) {
      const e = EvidenceSchema.parse(evidence);
      await db.execute(INSERT_SQL, [
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
      ]);
      return e;
    },
    async findById(id) {
      const row = await db.get<Row>(`SELECT * FROM evidence WHERE id = ?`, [id]);
      return row ? toDomain(row) : null;
    },
    async listByCompany(companyId) {
      const rows = await db.all<Row>(
        `SELECT * FROM evidence WHERE company_id = ? ORDER BY detected_at DESC`,
        [companyId],
      );
      return rows.map(toDomain);
    },
    async findBySourceAndHash(sourceUrl, rawTextHash) {
      const row = await db.get<Row>(
        `SELECT * FROM evidence WHERE source_url = ? AND raw_text_hash = ? LIMIT 1`,
        [sourceUrl, rawTextHash],
      );
      return row ? toDomain(row) : null;
    },
    async findAnyBySourceUrl(sourceUrl) {
      const row = await db.get<Row>(
        `SELECT * FROM evidence WHERE source_url = ? ORDER BY detected_at DESC LIMIT 1`,
        [sourceUrl],
      );
      return row ? toDomain(row) : null;
    },
  };
}
