import type { Repositories } from '@netruimte/shared';
import { openDb, type Db } from './db.js';
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

export { openDb } from './db.js';
export type { Db } from './db.js';
