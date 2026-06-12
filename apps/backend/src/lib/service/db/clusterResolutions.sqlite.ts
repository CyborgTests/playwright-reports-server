import { getDatabase } from './db.js';
import { singletonOf } from './singleton.js';

export type ClusterOverrideState = 'resolved' | 'active';

export interface ClusterResolutionRow {
  clusterId: string;
  project: string | null;
  resolvedAt: string;
  state: ClusterOverrideState;
  note: string | null;
}

export class ClusterResolutionsDatabase {
  private readonly db = getDatabase();

  public setOverride(input: {
    clusterId: string;
    state: ClusterOverrideState;
    project?: string | null;
    note?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO cluster_resolutions (clusterId, project, resolvedAt, state, note)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(clusterId) DO UPDATE SET
           resolvedAt = excluded.resolvedAt,
           state = excluded.state,
           note = excluded.note`
      )
      .run(
        input.clusterId,
        input.project ?? null,
        new Date().toISOString(),
        input.state,
        input.note ?? null
      );
  }

  // Single-pass load used by the cluster enrichment. Keyed by clusterId so the
  // caller can look up by cluster.id without an extra round-trip per cluster.
  public getAllOverrides(): Map<string, ClusterResolutionRow> {
    const rows = this.db
      .prepare('SELECT clusterId, project, resolvedAt, state, note FROM cluster_resolutions')
      .all() as ClusterResolutionRow[];
    return new Map(rows.map((r) => [r.clusterId, r]));
  }
}

export const clusterResolutionsDb = singletonOf(
  'clusterResolutions',
  () => new ClusterResolutionsDatabase()
);
