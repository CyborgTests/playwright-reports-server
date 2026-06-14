import { getDatabase } from './db.js';
import { type ClusterResolutionsRow, getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export type ClusterOverrideState = 'resolved' | 'active';

export type ClusterResolutionRow = ClusterResolutionsRow;

export class ClusterResolutionsDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public setOverride(input: {
    clusterId: string;
    state: ClusterOverrideState;
    project?: string | null;
    note?: string | null;
  }): void {
    const compiled = this.k
      .insertInto('cluster_resolutions')
      .values({
        clusterId: input.clusterId,
        project: input.project ?? null,
        resolvedAt: new Date().toISOString(),
        state: input.state,
        note: input.note ?? null,
      })
      .onConflict((oc) =>
        oc.column('clusterId').doUpdateSet((eb) => ({
          resolvedAt: eb.ref('excluded.resolvedAt'),
          state: eb.ref('excluded.state'),
          note: eb.ref('excluded.note'),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  // Single-pass load used by the cluster enrichment. Keyed by clusterId so the
  // caller can look up by cluster.id without an extra round-trip per cluster.
  public getAllOverrides(): Map<string, ClusterResolutionRow> {
    const compiled = this.k
      .selectFrom('cluster_resolutions')
      .select(['clusterId', 'project', 'resolvedAt', 'state', 'note'])
      .compile();
    const rows = this.db
      .prepare(compiled.sql)
      .all(...compiled.parameters) as ClusterResolutionRow[];
    return new Map(rows.map((r) => [r.clusterId, r]));
  }
}

export const clusterResolutionsDb = singletonOf(
  'clusterResolutions',
  () => new ClusterResolutionsDatabase()
);
