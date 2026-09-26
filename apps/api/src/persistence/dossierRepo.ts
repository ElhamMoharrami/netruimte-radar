import {
  DossierSchema,
  type Dossier,
  type DossierRepository,
} from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  opportunity_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: Row): Dossier {
  return DossierSchema.parse({
    id: row.id,
    opportunityId: row.opportunity_id,
    content: JSON.parse(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function createDossierRepository(db: Db): DossierRepository {
  const upsertStmt = db.prepare(`
    INSERT INTO dossiers (id, opportunity_id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(opportunity_id) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at
  `);
  const byOpp = db.prepare(`SELECT * FROM dossiers WHERE opportunity_id = ?`);

  return {
    async upsert(dossier) {
      const d = DossierSchema.parse(dossier);
      upsertStmt.run(
        d.id,
        d.opportunityId,
        JSON.stringify(d.content),
        d.createdAt,
        d.updatedAt,
      );
      return d;
    },
    async findByOpportunity(opportunityId) {
      const row = byOpp.get(opportunityId) as unknown as Row | undefined;
      return row ? toDomain(row) : null;
    },
  };
}
