import { DecisionSchema, type Decision, type DecisionRepository } from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  opportunity_id: string;
  decision_type: string;
  reason: string;
  policy_version: string;
  created_at: string;
}

function toDomain(row: Row): Decision {
  return DecisionSchema.parse({
    id: row.id,
    opportunityId: row.opportunity_id,
    decisionType: row.decision_type,
    reason: row.reason,
    policyVersion: row.policy_version,
    createdAt: row.created_at,
  });
}

export function createDecisionRepository(db: Db): DecisionRepository {
  const insertStmt = db.prepare(`
    INSERT INTO decisions (id, opportunity_id, decision_type, reason, policy_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const byOpp = db.prepare(`SELECT * FROM decisions WHERE opportunity_id = ? ORDER BY created_at ASC`);

  return {
    async insert(decision) {
      const d = DecisionSchema.parse(decision);
      insertStmt.run(d.id, d.opportunityId, d.decisionType, d.reason, d.policyVersion, d.createdAt);
      return d;
    },
    async listByOpportunity(opportunityId) {
      const rows = byOpp.all(opportunityId) as unknown as Row[];
      return rows.map(toDomain);
    },
  };
}
