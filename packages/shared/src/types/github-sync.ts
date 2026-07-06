export interface GithubSyncConfig {
  id: string;
  name: string;
  enabled: boolean;
  repo: string;
  workflow: string;
  tokenSet: boolean;
  startDate: string;
  artifactPattern: string;
  // Template strings with placeholders: ${match1}, ${branch}, ${runDate}, ${runId}.
  projectTemplate: string;
  titleTemplate: string;
  cronSchedule: string;
  createdAt: string;
  updatedAt: string;
}

export type GithubSyncRunStatus = 'running' | 'success' | 'failed' | 'cancelled';

export interface GithubSyncRun {
  id: string;
  syncConfigId: string;
  status: GithubSyncRunStatus;
  trigger: 'cron' | 'manual';
  startedAt: string;
  finishedAt?: string;
  uploaded: number;
  skipped: number;
  failed: number;
  message?: string;
}

export type SyncPhase = 'scanning' | 'downloading' | 'uploading';

export interface SyncTransfer {
  artifact: string;
  done: number;
  total: number;
}

export interface SyncProgress {
  phase: SyncPhase;
  total: number;
  current: number;
  download?: SyncTransfer;
  upload?: SyncTransfer;
  uploaded: number;
  failed: number;
  skipped: number;
  startedAt: string;
}

export interface GithubSyncStatus {
  configId: string;
  isRunning: boolean;
  lastRun?: GithubSyncRun;
  nextRun?: string;
  syncedArtifacts: number;
  progress?: SyncProgress;
}

export interface GithubSyncConfigInput {
  name: string;
  enabled?: boolean;
  repo: string;
  workflow: string;
  // Plain token from form. Omit/blank to keep existing; explicit "" to clear.
  token?: string;
  startDate: string;
  artifactPattern: string;
  projectTemplate: string;
  titleTemplate?: string;
  cronSchedule: string;
}
