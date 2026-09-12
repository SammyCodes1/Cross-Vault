const ATTEST_KEY = 'crossvault.attestJob';
const META_KEY = 'crossvault.positionMeta';

export interface AttestJobSnapshot {
  jobId: string;
  lockId: number;
  amount: string;
  sepoliaTx: string;
  blockNumber: number;
  startedAt: number;
}

export interface PositionMeta {
  lockId?: number;
  sepoliaTx?: string;
  cc3Tx?: string;
  claimed?: boolean;
  claimTx?: string;
}

function metaStore(): Record<string, PositionMeta> {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveAttestJob(job: AttestJobSnapshot) {
  try {
    localStorage.setItem(ATTEST_KEY, JSON.stringify(job));
  } catch {
    /* ignore */
  }
}

export function loadAttestJob(): AttestJobSnapshot | null {
  try {
    const raw = localStorage.getItem(ATTEST_KEY);
    if (!raw) return null;
    const job = JSON.parse(raw) as AttestJobSnapshot;
    if (!job.jobId || Date.now() - job.startedAt > 20 * 60 * 1000) {
      clearAttestJob();
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

export function clearAttestJob() {
  try {
    localStorage.removeItem(ATTEST_KEY);
  } catch {
    /* ignore */
  }
}

export function savePositionMeta(vault: string, positionId: number, patch: PositionMeta) {
  const key = `${vault.toLowerCase()}-${positionId}`;
  const all = metaStore();
  all[key] = { ...all[key], ...patch };
  try {
    localStorage.setItem(META_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function loadPositionMeta(vault: string, positionId: number): PositionMeta {
  return metaStore()[`${vault.toLowerCase()}-${positionId}`] || {};
}
