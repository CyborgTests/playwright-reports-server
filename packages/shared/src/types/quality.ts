export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export const GRADE_ORDER: readonly Grade[] = ['S', 'A', 'B', 'C', 'D', 'F'] as const;

export type GradeFormula = 'strict' | 'lenient';

export interface GradeBands {
  S: number;
  A: number;
  B: number;
  C: number;
  D: number;
}

export interface QualityDashboard {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  homeOrder: number;
  stalenessDays: number;
  defaultGradeBands: GradeBands;
  defaultFormula: GradeFormula;
  defaultMinOkGrade: Grade;
  createdAt: string;
  updatedAt: string;
}

export type QualityNodeKind = 'group' | 'project';

export interface QualityNode {
  id: string;
  dashboardId: string;
  parentNodeId: string | null;
  kind: QualityNodeKind;
  name: string;
  projectName?: string | null;
  weight: number;
  sortOrder: number;
  gradeBands?: GradeBands | null;
  formula?: GradeFormula | null;
  minOkGrade?: Grade | null;
}

export interface QualityTreeNode extends QualityNode {
  children: QualityTreeNode[];
}

export interface QualityNodeStats {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  total: number;
}

export type Trend = 'up' | 'down' | 'flat';

export interface QualityNodeSnapshot {
  nodeId: string;
  kind: QualityNodeKind;
  name: string;
  weight: number;
  passRate: number;
  grade: Grade;
  isOk: boolean;
  minOkGrade: Grade;
  formulaUsed: GradeFormula;
  bandsUsed: GradeBands;
  previousPassRate?: number;
  trend?: Trend;
  empty?: boolean;
  projectName?: string;
  latestReportId?: string | null;
  latestReportAt?: string | null;
  stale?: boolean;
  hasReports?: boolean;
  stats?: QualityNodeStats;
  children?: QualityNodeSnapshot[];
}

export interface QualityDashboardSnapshot {
  dashboard: QualityDashboard;
  root: QualityNodeSnapshot;
  computedAt: string;
}

export interface QualityDashboardSummary {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  homeOrder: number;
}

export interface QualityNodeInput {
  id?: string;
  parentNodeId: string | null;
  kind: QualityNodeKind;
  name: string;
  projectName?: string | null;
  weight: number;
  sortOrder: number;
  gradeBands?: GradeBands | null;
  formula?: GradeFormula | null;
  minOkGrade?: Grade | null;
}

export interface QualityDashboardConfig {
  dashboard: QualityDashboard;
  nodes: QualityNode[];
}
