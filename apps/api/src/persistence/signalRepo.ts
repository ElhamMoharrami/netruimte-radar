import { SignalSchema, type Signal, type SignalRepository } from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  company_id: string;
  evidence_ids: string;
  type: string;
  description: string;
  estimated_impact_class: string;
  confidence: number;
  detected_at: string;
}

function toDomain(row: Row): Signal {
  return SignalSchema.parse({
    id: row.id,
    companyId: row.company_id,
    evidenceIds: JSON.parse(row.evidence_ids) as string[],
    type: row.type,
    description: row.description,
    estimatedImpactClass: row.estimated_impact_class,
    confidence: row.confidence,
    detectedAt: row.detected_at,
  });
}

export function createSignalRepository(db: Db): SignalRepository {
  const insertStmt = db.prepare(`
    INSERT INTO signals (id, company_id, evidence_ids, type, description, estimated_impact_class, confidence, detected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.prepare(`SELECT * FROM signals WHERE id = ?`);
  const byCompany = db.prepare(`SELECT * FROM signals WHERE company_id = ? ORDER BY detected_at DESC`);

  return {
    async insert(signal) {
      const s = SignalSchema.parse(signal);
      insertStmt.run(
        s.id,
        s.companyId,
        JSON.stringify(s.evidenceIds),
        s.type,
        s.description,
        s.estimatedImpactClass,
        s.confidence,
        s.detectedAt,
      );
      return s;
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
