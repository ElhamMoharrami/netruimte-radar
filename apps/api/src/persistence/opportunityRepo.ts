import { OpportunitySchema, type Opportunity, type OpportunityRepository } from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  company_id: string;
  signal_ids: string;
  status: string;
  score: number;
  confidence: number;
  congestion_context: string | null;
  grid_neighbor_status: string;
  recommended_next_step: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: Row): Opportunity {
  return OpportunitySchema.parse({
    id: row.id,
    companyId: row.company_id,
    signalIds: JSON.parse(row.signal_ids) as string[],
    status: row.status,
    score: row.score,
    confidence: row.confidence,
    congestionContext: row.congestion_context ? JSON.parse(row.congestion_context) : null,
    gridNeighborStatus: row.grid_neighbor_status,
    recommendedNextStep: row.recommended_next_step,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const INSERT_SQL = `
  INSERT INTO opportunities (id, company_id, signal_ids, status, score, confidence, congestion_context, grid_neighbor_status, recommended_next_step, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const UPDATE_SQL = `
  UPDATE opportunities SET
    signal_ids=?, status=?, score=?, confidence=?,
    congestion_context=?, grid_neighbor_status=?, recommended_next_step=?,
    updated_at=?
  WHERE id=?
`;

export function createOpportunityRepository(db: Db): OpportunityRepository {
  return {
    async insert(opportunity) {
      const o = OpportunitySchema.parse(opportunity);
      await db.execute(INSERT_SQL, [
        o.id,
        o.companyId,
        JSON.stringify(o.signalIds),
        o.status,
        o.score,
        o.confidence,
        o.congestionContext ? JSON.stringify(o.congestionContext) : null,
        o.gridNeighborStatus,
        o.recommendedNextStep,
        o.createdAt,
        o.updatedAt,
      ]);
      return o;
    },
    async update(opportunity) {
      const o = OpportunitySchema.parse(opportunity);
      await db.execute(UPDATE_SQL, [
        JSON.stringify(o.signalIds),
        o.status,
        o.score,
        o.confidence,
        o.congestionContext ? JSON.stringify(o.congestionContext) : null,
        o.gridNeighborStatus,
        o.recommendedNextStep,
        o.updatedAt,
        o.id,
      ]);
      return o;
    },
    async findById(id) {
      const row = await db.get<Row>(`SELECT * FROM opportunities WHERE id = ?`, [id]);
      return row ? toDomain(row) : null;
    },
    async findByCompany(companyId) {
      const rows = await db.all<Row>(
        `SELECT * FROM opportunities WHERE company_id = ? ORDER BY updated_at DESC`,
        [companyId],
      );
      return rows.map(toDomain);
    },
    async list() {
      const rows = await db.all<Row>(`SELECT * FROM opportunities ORDER BY updated_at DESC`);
      return rows.map(toDomain);
    },
  };
}
