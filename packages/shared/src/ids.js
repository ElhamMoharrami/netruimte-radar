import { randomUUID } from 'node:crypto';
const rand = () => randomUUID();
export const newId = {
    company: () => `co_${rand()}`,
    evidence: () => `ev_${rand()}`,
    signal: () => `sig_${rand()}`,
    opportunity: () => `op_${rand()}`,
    decision: () => `dec_${rand()}`,
    activity: () => `act_${rand()}`,
};
export function nowIso() {
    return new Date().toISOString();
}
