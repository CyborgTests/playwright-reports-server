import type { GhArtifact, GhWorkflowRun } from './githubApi.js';

export interface ToUpload {
  artifact: GhArtifact;
  workflowRunId: string;
  runDate: string;
  headBranch: string;
  workflowName: string;
  envMatch: string;
}

interface ScanCounts {
  skippedSynced: number;
  skippedExpired: number;
  skippedAbandoned: number;
  planned: number;
}

interface ScanInput {
  runs: GhWorkflowRun[];
  artifactsOf: (runId: number) => Promise<GhArtifact[]>;
  isSynced: (artifactId: string) => boolean;
  isAbandoned: (artifactId: string) => boolean;
  pattern: RegExp;
  fullScan?: boolean;
  onCounts?: (counts: ScanCounts) => void;
}

interface ScanPlan extends ScanCounts {
  toUpload: ToUpload[];
  earlyExit?: string;
}

export async function planScan(input: ScanInput): Promise<ScanPlan> {
  const toUpload: ToUpload[] = [];
  let skippedSynced = 0;
  let skippedExpired = 0;
  let skippedAbandoned = 0;
  let earlyExit: string | undefined;

  const counts = (): ScanCounts => ({
    skippedSynced,
    skippedExpired,
    skippedAbandoned,
    planned: toUpload.length,
  });

  for (const run of input.runs) {
    const artifacts = await input.artifactsOf(run.id);
    const matching = artifacts.flatMap((artifact) => {
      const match = input.pattern.exec(artifact.name);
      return match ? [{ artifact, match }] : [];
    });
    if (matching.length === 0) continue;

    const state = matching.map(({ artifact, match }) => {
      const id = String(artifact.id);
      const synced = input.isSynced(id);
      const abandoned = !synced && !input.fullScan && input.isAbandoned(id);
      return {
        artifact,
        match,
        synced,
        abandoned,
        expired: !synced && !abandoned && artifact.expired,
      };
    });

    skippedSynced += state.filter((entry) => entry.synced).length;
    skippedExpired += state.filter((entry) => entry.expired).length;
    skippedAbandoned += state.filter((entry) => entry.abandoned).length;

    const accountedFor = state.every((entry) => entry.synced || entry.expired || entry.abandoned);
    if (accountedFor && !input.fullScan) {
      earlyExit = `all artifacts accounted for in run ${run.id}`;
      input.onCounts?.(counts());
      break;
    }

    for (const entry of state) {
      if (entry.synced || entry.expired || entry.abandoned) continue;
      toUpload.push({
        artifact: entry.artifact,
        workflowRunId: String(run.id),
        runDate: run.created_at.slice(0, 10),
        headBranch: run.head_branch ?? '',
        workflowName: run.name ?? '',
        envMatch: entry.match[1] ?? '',
      });
    }
    input.onCounts?.(counts());
  }

  toUpload.reverse();
  return { toUpload, ...counts(), earlyExit };
}
