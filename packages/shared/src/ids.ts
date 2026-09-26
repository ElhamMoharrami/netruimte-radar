import { randomUUID } from 'node:crypto';

const rand = (): string => randomUUID();

export const newId = {
  company: () => `co_${rand()}`,
  evidence: () => `ev_${rand()}`,
  signal: () => `sig_${rand()}`,
  opportunity: () => `op_${rand()}`,
  decision: () => `dec_${rand()}`,
  activity: () => `act_${rand()}`,
  gridEvent: () => `gev_${rand()}`,
};

export function nowIso(): string {
  return new Date().toISOString();
}
