import type { Repositories } from '@netruimte/shared';
import { openDb, type Db } from './db.js';
import { createLibsqlSqlClient, type LibsqlOptions } from './sqlClient.js';
import { createCompanyRepository } from './companyRepo.js';
import { createEvidenceRepository } from './evidenceRepo.js';
import { createSignalRepository } from './signalRepo.js';
import { createOpportunityRepository } from './opportunityRepo.js';
import { createDecisionRepository } from './decisionRepo.js';
import { createActivityLogRepository } from './activityRepo.js';
import { createRunHistoryRepository } from './runHistoryRepo.js';
import { createDossierRepository } from './dossierRepo.js';
import { createActionQueueRepository } from './actionQueueRepo.js';
import { createGridEventRepository } from './gridEventRepo.js';

/** Wire every repository against a single {@link Db} (== SqlClient) instance. */
export function createRepositories(db: Db): Repositories {
  return {
    companies: createCompanyRepository(db),
    evidence: createEvidenceRepository(db),
    signals: createSignalRepository(db),
    opportunities: createOpportunityRepository(db),
    decisions: createDecisionRepository(db),
    activity: createActivityLogRepository(db),
    runs: createRunHistoryRepository(db),
    dossiers: createDossierRepository(db),
    actionQueue: createActionQueueRepository(db),
    gridEvents: createGridEventRepository(db),
  };
}

/** Async opener for libSQL/Turso — required in production on Netlify. */
export async function openLibsqlDb(opts: LibsqlOptions): Promise<Db> {
  return createLibsqlSqlClient(opts);
}

export { openDb } from './db.js';
export type { Db } from './db.js';
export type { SqlClient, LibsqlOptions } from './sqlClient.js';
