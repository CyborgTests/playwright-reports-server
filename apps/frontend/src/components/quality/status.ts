import type { QualityDashboardSnapshot, QualityNodeSnapshot } from '@playwright-reports/shared';

export type WorstStatus = 'ok' | 'stale' | 'notOk' | 'empty';

export function worstStatus(snapshot: QualityNodeSnapshot): WorstStatus {
  if (snapshot.empty) return 'empty';
  let status: WorstStatus = 'ok';
  const visit = (n: QualityNodeSnapshot): void => {
    if (n.kind === 'project') {
      if (n.empty) return; // empty leaves don't downgrade the root
      if (!n.isOk) status = 'notOk';
      else if (n.stale && status === 'ok') status = 'stale';
      return;
    }
    if (!n.isOk && status !== 'notOk') status = 'notOk';
    for (const c of n.children ?? []) visit(c);
  };
  visit(snapshot);
  return status;
}

export interface HomeAggregate {
  dashboards: number;
  projects: number;
  ok: number;
  notOk: number;
  stale: number;
  noData: number;
  worst: WorstStatus;
  newestComputedAt?: string;
}

export function aggregateHome(snapshots: QualityDashboardSnapshot[]): HomeAggregate {
  let ok = 0;
  let notOk = 0;
  let stale = 0;
  let noData = 0;
  let projects = 0;
  let worst: WorstStatus = 'ok';
  let newestComputedAt: string | undefined;

  const visitProject = (n: QualityNodeSnapshot): void => {
    projects += 1;
    if (n.empty) {
      noData += 1;
      return;
    }
    if (!n.isOk) {
      notOk += 1;
      worst = 'notOk';
    } else if (n.stale) {
      stale += 1;
      if (worst !== 'notOk') worst = 'stale';
    } else {
      ok += 1;
    }
  };
  const visit = (n: QualityNodeSnapshot): void => {
    if (n.kind === 'project') {
      visitProject(n);
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  for (const s of snapshots) {
    visit(s.root);
    if (!newestComputedAt || s.computedAt > newestComputedAt) newestComputedAt = s.computedAt;
  }

  return {
    dashboards: snapshots.length,
    projects,
    ok,
    notOk,
    stale,
    noData,
    worst,
    newestComputedAt,
  };
}
