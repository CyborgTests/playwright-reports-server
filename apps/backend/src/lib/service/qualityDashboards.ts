import type {
  Grade,
  GradeBands,
  GradeFormula,
  QualityDashboardConfig,
  QualityDashboardSnapshot,
  QualityNode,
  QualityNodeSnapshot,
  QualityNodeStats,
  QualityTreeNode,
  ReportStats,
  Trend,
} from '@playwright-reports/shared';
import {
  computePassRate,
  DEFAULT_GRADE_BANDS,
  gradeFor,
  isVerdictOk,
  normalizeStats,
  weightedAverage,
} from '@playwright-reports/shared';

import type { ReportHistory } from '../storage/types.js';
import { qualityDashboardsDb, type ReportHistoryLite, reportDb } from './db/index.js';

function buildTree(nodes: QualityNode[]): QualityTreeNode[] {
  const byId = new Map<string, QualityTreeNode>();
  for (const n of nodes) {
    byId.set(n.id, { ...n, children: [] });
  }
  const roots: QualityTreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentNodeId ? byId.get(n.parentNodeId) : undefined;
    if (parent) {
      parent.children.push(n);
    } else {
      roots.push(n);
    }
  }
  const sortChildren = (arr: QualityTreeNode[]): void => {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const child of arr) sortChildren(child.children);
  };
  sortChildren(roots);
  return roots;
}

interface Inheritance {
  bands: GradeBands;
  formula: GradeFormula;
  minOk: Grade;
}

function inherit(parent: Inheritance, node: QualityTreeNode): Inheritance {
  return {
    bands: node.gradeBands ?? parent.bands,
    formula: node.formula ?? parent.formula,
    minOk: node.minOkGrade ?? parent.minOk,
  };
}

function reportToStats(
  report: ReportHistory | ReportHistoryLite | undefined
): QualityNodeStats | undefined {
  const raw = report?.stats as ReportStats | undefined;
  if (!raw) return undefined;
  return normalizeStats({
    expected: raw.expected,
    unexpected: raw.unexpected,
    flaky: raw.flaky,
    skipped: raw.skipped,
    total: raw.total,
  });
}

const TREND_FLAT_EPSILON = 1;

function trendFor(current: number, previous: number | undefined): Trend | undefined {
  if (previous === undefined) return undefined;
  const delta = current - previous;
  if (delta > TREND_FLAT_EPSILON) return 'up';
  if (delta < -TREND_FLAT_EPSILON) return 'down';
  return 'flat';
}

type LatestReportsByProject = Map<string, ReportHistoryLite[]>;

function collectProjectNames(nodes: QualityTreeNode[]): string[] {
  const out = new Set<string>();
  const visit = (n: QualityTreeNode): void => {
    if (n.kind === 'project') {
      out.add(n.projectName ?? n.name);
    } else {
      for (const child of n.children) visit(child);
    }
  };
  for (const root of nodes) visit(root);
  return Array.from(out);
}

function snapshotProject(
  node: QualityTreeNode,
  parent: Inheritance,
  stalenessMs: number,
  now: number,
  latestByProject: LatestReportsByProject
): QualityNodeSnapshot {
  const resolved = inherit(parent, node);
  const projectName = node.projectName ?? node.name;
  const reports = latestByProject.get(projectName) ?? [];
  const latest = reports[0];
  const previous = reports[1];
  const stats = reportToStats(latest);

  if (!latest || !stats) {
    return {
      nodeId: node.id,
      kind: 'project',
      name: node.name,
      weight: node.weight,
      passRate: 0,
      grade: 'F',
      isOk: false,
      minOkGrade: resolved.minOk,
      formulaUsed: resolved.formula,
      bandsUsed: resolved.bands,
      empty: true,
      projectName,
      latestReportId: null,
      latestReportAt: null,
      stale: true,
      hasReports: false,
    };
  }

  const passRate = computePassRate(stats, resolved.formula);
  const grade = gradeFor(passRate, resolved.bands);
  const reportTime = Date.parse(latest.createdAt);
  const stale = Number.isFinite(reportTime) && now - reportTime > stalenessMs;
  const latestReportAt = latest.createdAt;

  const prevStats = reportToStats(previous);
  const previousPassRate = prevStats ? computePassRate(prevStats, resolved.formula) : undefined;
  const trend = trendFor(passRate, previousPassRate);

  return {
    nodeId: node.id,
    kind: 'project',
    name: node.name,
    weight: node.weight,
    passRate,
    grade,
    isOk: isVerdictOk(grade, resolved.minOk),
    minOkGrade: resolved.minOk,
    formulaUsed: resolved.formula,
    bandsUsed: resolved.bands,
    previousPassRate,
    trend,
    projectName,
    latestReportId: latest.reportID,
    latestReportAt,
    stale,
    hasReports: true,
    stats,
  };
}

function snapshotGroup(
  node: QualityTreeNode,
  parent: Inheritance,
  stalenessMs: number,
  now: number,
  latestByProject: LatestReportsByProject
): QualityNodeSnapshot {
  const resolved = inherit(parent, node);
  const children = node.children.map((child) =>
    child.kind === 'group'
      ? snapshotGroup(child, resolved, stalenessMs, now, latestByProject)
      : snapshotProject(child, resolved, stalenessMs, now, latestByProject)
  );

  const contributing = children.filter((c) => c.weight > 0);
  const empty =
    children.length === 0 || (contributing.length > 0 && contributing.every((c) => c.empty));

  const passRate = weightedAverage(children.map((c) => ({ value: c.passRate, weight: c.weight })));
  const grade = gradeFor(passRate, resolved.bands);
  const isOk = empty ? false : children.every((c) => c.weight <= 0 || c.isOk);

  const previousPassRate = rollupPreviousPassRate(children);
  const trend = trendFor(passRate, previousPassRate);

  return {
    nodeId: node.id,
    kind: 'group',
    name: node.name,
    weight: node.weight,
    passRate,
    grade,
    isOk,
    minOkGrade: resolved.minOk,
    formulaUsed: resolved.formula,
    bandsUsed: resolved.bands,
    previousPassRate,
    trend,
    empty,
    children,
  };
}

function rollupPreviousPassRate(children: QualityNodeSnapshot[]): number | undefined {
  const withPrev = children.filter((c) => typeof c.previousPassRate === 'number' && c.weight > 0);
  if (withPrev.length === 0) return undefined;
  return weightedAverage(
    withPrev.map((c) => ({ value: c.previousPassRate as number, weight: c.weight }))
  );
}

export class QualityDashboardsService {
  public getConfigBySlug(slug: string): QualityDashboardConfig | null {
    const dashboard = qualityDashboardsDb.getBySlug(slug);
    if (!dashboard) return null;
    return qualityDashboardsDb.getConfig(dashboard.id);
  }

  public getSnapshotBySlug(slug: string): QualityDashboardSnapshot | null {
    const config = this.getConfigBySlug(slug);
    if (!config) return null;
    return this.computeSnapshot(config);
  }

  private computeSnapshot(config: QualityDashboardConfig): QualityDashboardSnapshot {
    const { dashboard, nodes } = config;
    const tree = buildTree(nodes);
    const stalenessMs = Math.max(0, dashboard.stalenessDays) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const rootInheritance: Inheritance = {
      bands: dashboard.defaultGradeBands ?? DEFAULT_GRADE_BANDS,
      formula: dashboard.defaultFormula,
      minOk: dashboard.defaultMinOkGrade,
    };

    const projectNames = collectProjectNames(tree);
    const latestByProject = reportDb.getLatestByProjects(projectNames, 2);

    const rootChildren = tree.map((child) =>
      child.kind === 'group'
        ? snapshotGroup(child, rootInheritance, stalenessMs, now, latestByProject)
        : snapshotProject(child, rootInheritance, stalenessMs, now, latestByProject)
    );

    const passRate = weightedAverage(
      rootChildren.map((c) => ({ value: c.passRate, weight: c.weight }))
    );
    const grade = gradeFor(passRate, rootInheritance.bands);
    const contributing = rootChildren.filter((c) => c.weight > 0);
    const empty =
      rootChildren.length === 0 || (contributing.length > 0 && contributing.every((c) => c.empty));
    const isOk = empty ? false : rootChildren.every((c) => c.weight <= 0 || c.isOk);
    const previousPassRate = rollupPreviousPassRate(rootChildren);
    const trend = trendFor(passRate, previousPassRate);

    const root: QualityNodeSnapshot = {
      nodeId: 'root',
      kind: 'group',
      name: dashboard.name,
      weight: 1,
      passRate,
      grade,
      isOk,
      minOkGrade: rootInheritance.minOk,
      formulaUsed: rootInheritance.formula,
      bandsUsed: rootInheritance.bands,
      previousPassRate,
      trend,
      empty,
      children: rootChildren,
    };

    return {
      dashboard,
      root,
      computedAt: new Date().toISOString(),
    };
  }

  public getHomeSnapshots(): QualityDashboardSnapshot[] {
    const pinned = qualityDashboardsDb.listPinned();
    return pinned
      .map((dashboard) => {
        const config = qualityDashboardsDb.getConfig(dashboard.id);
        if (!config) return null;
        return this.computeSnapshot(config);
      })
      .filter((s): s is QualityDashboardSnapshot => s !== null);
  }
}

export const qualityDashboardsService = new QualityDashboardsService();
