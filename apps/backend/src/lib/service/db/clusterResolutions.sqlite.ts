import { getDatabase } from './db.js';
import { type ClusterResolutionsRow, getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';
import { chunk } from './utils.js';

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

  // Loads overrides for just the clusters being enriched (keyed by clusterId so
  // the caller looks up by cluster.id without a per-cluster round-trip). Bounded
  // by the number of clusters in play rather than the whole resolutions table.
  public getOverridesByClusterIds(clusterIds: string[]): Map<string, ClusterResolutionRow> {
    const out = new Map<string, ClusterResolutionRow>();
    if (clusterIds.length === 0) return out;
    for (const batch of chunk(clusterIds, 300)) {
      const compiled = this.k
        .selectFrom('cluster_resolutions')
        .select(['clusterId', 'project', 'resolvedAt', 'state', 'note'])
        .where('clusterId', 'in', batch)
        .compile();
      const rows = this.db
        .prepare(compiled.sql)
        .all(...compiled.parameters) as ClusterResolutionRow[];
      for (const r of rows) out.set(r.clusterId, r);
    }
    return out;
  }
}

export const clusterResolutionsDb = singletonOf(
  'clusterResolutions',
  () => new ClusterResolutionsDatabase()
);
