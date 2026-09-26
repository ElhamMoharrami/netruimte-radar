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

const INSERT_SQL = `
  INSERT INTO signals (id, company_id, evidence_ids, type, description, estimated_impact_class, confidence, detected_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

export function createSignalRepository(db: Db): SignalRepository {
  return {
    async insert(signal) {
      const s = SignalSchema.parse(signal);
      await db.execute(INSERT_SQL, [
        s.id,
        s.companyId,
        JSON.stringify(s.evidenceIds),
        s.type,
        s.description,
        s.estimatedImpactClass,
        s.confidence,
        s.detectedAt,
      ]);
      return s;
    },
    async findById(id) {
      const row = await db.get<Row>(`SELECT * FROM signals WHERE id = ?`, [id]);
      return row ? toDomain(row) : null;
    },
    async listByCompany(companyId) {
      const rows = await db.all<Row>(
        `SELECT * FROM signals WHERE company_id = ? ORDER BY detected_at DESC`,
        [companyId],
      );
      return rows.map(toDomain);
    },
  };
}
