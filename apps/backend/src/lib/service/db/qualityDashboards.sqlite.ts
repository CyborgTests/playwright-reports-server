import { randomUUID as uuid } from 'node:crypto';
import type {
  Grade,
  GradeBands,
  GradeFormula,
  QualityDashboard,
  QualityDashboardConfig,
  QualityDashboardSummary,
  QualityNode,
  QualityNodeInput,
} from '@playwright-reports/shared';
import { DEFAULT_GRADE_BANDS } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';

import { getDatabase, hasMigrationMark, setMigrationMark } from './db.js';

import { singletonOf } from './singleton.js';
import { parseJsonColumn } from './utils.js';

interface DashboardRow {
  id: string;
  name: string;
  slug: string;
  isDefault: number;
  homeOrder: number;
  stalenessDays: number;
  defaultGradeBands: string;
  defaultFormula: string;
  defaultMinOkGrade: string;
  createdAt: string;
  updatedAt: string;
}

interface NodeRow {
  id: string;
  dashboardId: string;
  parentNodeId: string | null;
  kind: 'group' | 'project';
  name: string;
  projectName: string | null;
  weight: number;
  sortOrder: number;
  gradeBands: string | null;
  formula: string | null;
  minOkGrade: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToDashboard(row: DashboardRow): QualityDashboard {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isDefault: !!row.isDefault,
    homeOrder: row.homeOrder ?? 0,
    stalenessDays: row.stalenessDays,
    defaultGradeBands: parseJsonColumn<GradeBands>(row.defaultGradeBands, {
      ...DEFAULT_GRADE_BANDS,
    }),
    defaultFormula: row.defaultFormula as GradeFormula,
    defaultMinOkGrade: row.defaultMinOkGrade as Grade,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToNode(row: NodeRow): QualityNode {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    parentNodeId: row.parentNodeId,
    kind: row.kind,
    name: row.name,
    projectName: row.projectName,
    weight: row.weight,
    sortOrder: row.sortOrder,
    gradeBands: parseJsonColumn<GradeBands | null>(row.gradeBands, null),
    formula: (row.formula as GradeFormula | null) ?? null,
    minOkGrade: (row.minOkGrade as Grade | null) ?? null,
  };
}

export interface DashboardCreateInput {
  name: string;
  slug?: string;
  isDefault?: boolean;
  homeOrder?: number;
  stalenessDays?: number;
  defaultGradeBands?: GradeBands;
  defaultFormula?: GradeFormula;
  defaultMinOkGrade?: Grade;
}

export class DashboardNameConflictError extends Error {
  constructor(name: string) {
    super(`A dashboard named "${name}" already exists`);
    this.name = 'DashboardNameConflictError';
  }
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface DashboardUpdateInput {
  name?: string;
  slug?: string;
  isDefault?: boolean;
  homeOrder?: number;
  stalenessDays?: number;
  defaultGradeBands?: GradeBands;
  defaultFormula?: GradeFormula;
  defaultMinOkGrade?: Grade;
}

export class QualityDashboardsDatabase {
  private readonly db = getDatabase();

  private readonly listStmt: Database.Statement<[]>;
  private readonly listPinnedStmt: Database.Statement<[]>;
  private readonly getByIdStmt: Database.Statement<[string]>;
  private readonly getBySlugStmt: Database.Statement<[string]>;
  private readonly insertDashboardStmt: Database.Statement<
    [string, string, string, number, number, number, string, string, string, string, string]
  >;
  private readonly maxHomeOrderStmt: Database.Statement<[]>;
  private readonly deleteDashboardStmt: Database.Statement<[string]>;
  private readonly getNodesStmt: Database.Statement<[string]>;
  private readonly deleteNodesStmt: Database.Statement<[string]>;
  private readonly insertNodeStmt: Database.Statement<
    [
      string, // id
      string, // dashboardId
      string | null, // parentNodeId
      'group' | 'project', // kind
      string, // name
      string | null, // projectName
      number, // weight
      number, // sortOrder
      string | null, // gradeBands
      string | null, // formula
      string | null, // minOkGrade
      string, // createdAt
      string, // updatedAt
    ]
  >;

  constructor() {
    this.listStmt = this.db.prepare(
      `SELECT id, name, slug, isDefault, homeOrder FROM quality_dashboards
       ORDER BY isDefault DESC, homeOrder ASC, name ASC`
    );

    this.listPinnedStmt = this.db.prepare(
      `SELECT * FROM quality_dashboards
       WHERE isDefault = 1
       ORDER BY homeOrder ASC, name ASC`
    );

    this.getByIdStmt = this.db.prepare('SELECT * FROM quality_dashboards WHERE id = ?');
    this.getBySlugStmt = this.db.prepare('SELECT * FROM quality_dashboards WHERE slug = ?');

    this.insertDashboardStmt = this.db.prepare(`
      INSERT INTO quality_dashboards (
        id, name, slug, isDefault, homeOrder, stalenessDays,
        defaultGradeBands, defaultFormula, defaultMinOkGrade,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.maxHomeOrderStmt = this.db.prepare(
      'SELECT COALESCE(MAX(homeOrder), -1) as maxOrder FROM quality_dashboards WHERE isDefault = 1'
    );

    this.deleteDashboardStmt = this.db.prepare('DELETE FROM quality_dashboards WHERE id = ?');

    this.getNodesStmt = this.db.prepare(
      'SELECT * FROM quality_dashboard_nodes WHERE dashboardId = ? ORDER BY sortOrder ASC, createdAt ASC'
    );

    this.deleteNodesStmt = this.db.prepare(
      'DELETE FROM quality_dashboard_nodes WHERE dashboardId = ?'
    );

    this.insertNodeStmt = this.db.prepare(`
      INSERT INTO quality_dashboard_nodes (
        id, dashboardId, parentNodeId, kind, name, projectName,
        weight, sortOrder, gradeBands, formula, minOkGrade,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  public listDashboards(): QualityDashboardSummary[] {
    const rows = this.listStmt.all() as Array<{
      id: string;
      name: string;
      slug: string;
      isDefault: number;
      homeOrder: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      isDefault: !!r.isDefault,
      homeOrder: r.homeOrder ?? 0,
    }));
  }

  public listPinned(): QualityDashboard[] {
    const rows = this.listPinnedStmt.all() as DashboardRow[];
    return rows.map(rowToDashboard);
  }

  public getById(id: string): QualityDashboard | null {
    const row = this.getByIdStmt.get(id) as DashboardRow | undefined;
    return row ? rowToDashboard(row) : null;
  }

  public getBySlug(slug: string): QualityDashboard | null {
    const row = this.getBySlugStmt.get(slug) as DashboardRow | undefined;
    return row ? rowToDashboard(row) : null;
  }

  public getConfig(id: string): QualityDashboardConfig | null {
    const dashboard = this.getById(id);
    if (!dashboard) return null;
    const nodes = (this.getNodesStmt.all(id) as NodeRow[]).map(rowToNode);
    return { dashboard, nodes };
  }

  public createDashboard(input: DashboardCreateInput): QualityDashboard {
    const name = input.name.trim();
    if (!name) throw new Error('Dashboard name is required');
    if (this.findIdByName(name)) {
      throw new DashboardNameConflictError(name);
    }

    const now = new Date().toISOString();
    const id = uuid();
    const bands = JSON.stringify(input.defaultGradeBands ?? DEFAULT_GRADE_BANDS);
    const formula: GradeFormula = input.defaultFormula ?? 'lenient';
    const minOk: Grade = input.defaultMinOkGrade ?? 'B';
    const pinned = !!input.isDefault;
    const order = input.homeOrder ?? (pinned ? this.nextHomeOrder() : 0);
    const slug = input.slug ?? this.uniqueSlugForName(name);

    this.insertDashboardStmt.run(
      id,
      name,
      slug,
      pinned ? 1 : 0,
      order,
      input.stalenessDays ?? 7,
      bands,
      formula,
      minOk,
      now,
      now
    );

    const created = this.getById(id);
    if (!created) throw new Error('Failed to create dashboard');
    return created;
  }

  private findIdByName(name: string, excludeId?: string): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM quality_dashboards
         WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
           AND (? IS NULL OR id <> ?)
         LIMIT 1`
      )
      .get(name, excludeId ?? null, excludeId ?? null) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private uniqueSlugForName(name: string): string {
    const base = slugify(name) || 'dashboard';
    const taken = new Set(
      (
        this.db
          .prepare('SELECT slug FROM quality_dashboards WHERE slug LIKE ? OR slug = ?')
          .all(`${base}-%`, base) as Array<{ slug: string }>
      ).map((r) => r.slug)
    );
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  private nextHomeOrder(): number {
    const row = this.maxHomeOrderStmt.get() as { maxOrder: number } | undefined;
    return (row?.maxOrder ?? -1) + 1;
  }

  public updateDashboard(id: string, patch: DashboardUpdateInput): QualityDashboard | null {
    const existing = this.getById(id);
    if (!existing) return null;

    if (patch.name !== undefined) {
      const nextName = patch.name.trim();
      if (!nextName) throw new Error('Dashboard name is required');
      if (this.findIdByName(nextName, id)) {
        throw new DashboardNameConflictError(nextName);
      }
    }

    const willBePinned = patch.isDefault ?? existing.isDefault;
    const becamePinned = !existing.isDefault && patch.isDefault === true;
    const homeOrder = patch.homeOrder ?? (becamePinned ? this.nextHomeOrder() : existing.homeOrder);

    const merged: QualityDashboard = {
      ...existing,
      name: patch.name?.trim() ?? existing.name,
      slug: patch.slug ?? existing.slug,
      isDefault: willBePinned,
      homeOrder,
      stalenessDays: patch.stalenessDays ?? existing.stalenessDays,
      defaultGradeBands: patch.defaultGradeBands ?? existing.defaultGradeBands,
      defaultFormula: patch.defaultFormula ?? existing.defaultFormula,
      defaultMinOkGrade: patch.defaultMinOkGrade ?? existing.defaultMinOkGrade,
    };
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE quality_dashboards SET
           name = ?, slug = ?, isDefault = ?, homeOrder = ?, stalenessDays = ?,
           defaultGradeBands = ?, defaultFormula = ?, defaultMinOkGrade = ?,
           updatedAt = ?
         WHERE id = ?`
      )
      .run(
        merged.name,
        merged.slug,
        merged.isDefault ? 1 : 0,
        merged.homeOrder,
        merged.stalenessDays,
        JSON.stringify(merged.defaultGradeBands),
        merged.defaultFormula,
        merged.defaultMinOkGrade,
        now,
        id
      );

    return this.getById(id);
  }

  public reorderPinned(orderedIds: string[]): QualityDashboard[] {
    const now = new Date().toISOString();
    const updateStmt = this.db.prepare(
      'UPDATE quality_dashboards SET homeOrder = ?, updatedAt = ? WHERE id = ? AND isDefault = 1'
    );
    const trx = this.db.transaction(() => {
      for (let idx = 0; idx < orderedIds.length; idx++) {
        updateStmt.run(idx, now, orderedIds[idx]);
      }
    });
    trx();
    return this.listPinned();
  }

  public deleteDashboard(id: string): boolean {
    const result = this.deleteDashboardStmt.run(id);
    return result.changes > 0;
  }

  public replaceTree(dashboardId: string, nodes: QualityNodeInput[]): QualityNode[] {
    if (!this.getById(dashboardId)) {
      throw new Error(`Dashboard ${dashboardId} not found`);
    }

    const freshIds = nodes.map(() => uuid());
    const idRemap = new Map<string, string>();
    nodes.forEach((n, idx) => {
      if (n.id) idRemap.set(n.id, freshIds[idx]);
    });

    const remapped: NodeRow[] = nodes.map((n, idx) => {
      const newId = freshIds[idx];
      const newParent = n.parentNodeId ? (idRemap.get(n.parentNodeId) ?? null) : null;
      const now = new Date().toISOString();
      return {
        id: newId,
        dashboardId,
        parentNodeId: newParent,
        kind: n.kind,
        name: n.name,
        projectName: n.kind === 'project' ? (n.projectName ?? null) : null,
        weight: Number.isFinite(n.weight) && n.weight >= 0 ? n.weight : 1,
        sortOrder: Number.isFinite(n.sortOrder) ? n.sortOrder : 0,
        gradeBands: n.gradeBands ? JSON.stringify(n.gradeBands) : null,
        formula: n.kind === 'project' ? (n.formula ?? null) : null,
        minOkGrade: n.minOkGrade ?? null,
        createdAt: now,
        updatedAt: now,
      };
    });

    const sorted: NodeRow[] = [];
    const byId = new Map(remapped.map((n) => [n.id, n] as const));
    const inserted = new Set<string>();
    const inProgress = new Set<string>();
    const visit = (node: NodeRow): void => {
      if (inserted.has(node.id)) return;
      if (inProgress.has(node.id)) {
        throw new Error('Cyclic parentNodeId graph in tree payload');
      }
      inProgress.add(node.id);
      if (node.parentNodeId) {
        const parent = byId.get(node.parentNodeId);
        if (parent) visit(parent);
      }
      inProgress.delete(node.id);
      inserted.add(node.id);
      sorted.push(node);
    };
    remapped.forEach(visit);

    const trx = this.db.transaction(() => {
      this.deleteNodesStmt.run(dashboardId);
      for (const n of sorted) {
        this.insertNodeStmt.run(
          n.id,
          n.dashboardId,
          n.parentNodeId,
          n.kind,
          n.name,
          n.projectName,
          n.weight,
          n.sortOrder,
          n.gradeBands,
          n.formula,
          n.minOkGrade,
          n.createdAt,
          n.updatedAt
        );
      }
      this.db
        .prepare('UPDATE quality_dashboards SET updatedAt = ? WHERE id = ?')
        .run(new Date().toISOString(), dashboardId);
    });
    trx();

    return sorted.map(rowToNode);
  }

  public listAvailableProjects(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT project FROM reports WHERE project IS NOT NULL ORDER BY project')
      .all() as Array<{ project: string }>;
    return rows.map((r) => r.project).filter(Boolean);
  }

  public seedDefaultIfEmpty(): void {
    const mark = 'quality_dashboards_seed_v1';
    if (hasMigrationMark(this.db, mark)) return;

    const existing = this.db.prepare('SELECT COUNT(*) as count FROM quality_dashboards').get() as {
      count: number;
    };
    if (existing.count > 0) {
      setMigrationMark(this.db, mark);
      return;
    }

    const dashboard = this.createDashboard({
      name: 'Overview',
      slug: 'overview',
      isDefault: true,
    });

    const projects = this.listAvailableProjects();
    if (projects.length > 0) {
      const nodes: QualityNodeInput[] = projects.map((projectName, idx) => ({
        parentNodeId: null,
        kind: 'project',
        name: projectName,
        projectName,
        weight: 1,
        sortOrder: idx,
      }));
      this.replaceTree(dashboard.id, nodes);
    }

    setMigrationMark(this.db, mark);
  }
}

export const qualityDashboardsDb = singletonOf(
  'qualityDashboards',
  () => new QualityDashboardsDatabase()
);
