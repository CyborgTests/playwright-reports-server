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
import { sql } from 'kysely';
import { getDatabase } from './db.js';
import { getKysely, type QualityDashboardNodesRow, type QualityDashboardsRow } from './kysely.js';
import { singletonOf } from './singleton.js';
import { parseJsonColumn } from './utils.js';

type DashboardRow = QualityDashboardsRow;
type NodeRow = QualityDashboardNodesRow;

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
    .replace(/[̀-ͯ]/g, '')
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
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public listDashboards(): QualityDashboardSummary[] {
    const compiled = this.k
      .selectFrom('quality_dashboards')
      .select(['id', 'name', 'slug', 'isDefault', 'homeOrder'])
      .orderBy('isDefault', 'desc')
      .orderBy('homeOrder', 'asc')
      .orderBy('name', 'asc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
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
    const compiled = this.k
      .selectFrom('quality_dashboards')
      .selectAll()
      .where('isDefault', '=', 1)
      .orderBy('homeOrder', 'asc')
      .orderBy('name', 'asc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as DashboardRow[];
    return rows.map(rowToDashboard);
  }

  public getById(id: string): QualityDashboard | null {
    const compiled = this.k
      .selectFrom('quality_dashboards')
      .selectAll()
      .where('id', '=', id)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | DashboardRow
      | undefined;
    return row ? rowToDashboard(row) : null;
  }

  public getBySlug(slug: string): QualityDashboard | null {
    const compiled = this.k
      .selectFrom('quality_dashboards')
      .selectAll()
      .where('slug', '=', slug)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | DashboardRow
      | undefined;
    return row ? rowToDashboard(row) : null;
  }

  public getConfig(id: string): QualityDashboardConfig | null {
    const dashboard = this.getById(id);
    if (!dashboard) return null;
    const compiled = this.k
      .selectFrom('quality_dashboard_nodes')
      .selectAll()
      .where('dashboardId', '=', id)
      .orderBy('sortOrder', 'asc')
      .orderBy('createdAt', 'asc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as NodeRow[];
    return { dashboard, nodes: rows.map(rowToNode) };
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

    const compiled = this.k
      .insertInto('quality_dashboards')
      .values({
        id,
        name,
        slug,
        isDefault: pinned ? 1 : 0,
        homeOrder: order,
        stalenessDays: input.stalenessDays ?? 7,
        defaultGradeBands: bands,
        defaultFormula: formula,
        defaultMinOkGrade: minOk,
        createdAt: now,
        updatedAt: now,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);

    const created = this.getById(id);
    if (!created) throw new Error('Failed to create dashboard');
    return created;
  }

  private findIdByName(name: string, excludeId?: string): string | null {
    // kysely doesn't model LOWER(TRIM(...)) comparisons inline well
    // using sql for the case-insensitive comparison.
    let q = this.k
      .selectFrom('quality_dashboards')
      .select('id')
      .where(sql`LOWER(TRIM(name))`, '=', sql`LOWER(TRIM(${name}))`);
    if (excludeId) q = q.where('id', '!=', excludeId);
    const compiled = q.limit(1).compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  private uniqueSlugForName(name: string): string {
    const base = slugify(name) || 'dashboard';
    const compiled = this.k
      .selectFrom('quality_dashboards')
      .select('slug')
      .where((eb) => eb.or([eb('slug', 'like', `${base}-%`), eb('slug', '=', base)]))
      .compile();
    const taken = new Set(
      (this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{ slug: string }>).map(
        (r) => r.slug
      )
    );
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  private nextHomeOrder(): number {
    const compiled = this.k
      .selectFrom('quality_dashboards')
      .select(sql<number>`COALESCE(MAX(homeOrder), -1)`.as('maxOrder'))
      .where('isDefault', '=', 1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { maxOrder: number }
      | undefined;
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

    const compiled = this.k
      .updateTable('quality_dashboards')
      .set({
        name: merged.name,
        slug: merged.slug,
        isDefault: merged.isDefault ? 1 : 0,
        homeOrder: merged.homeOrder,
        stalenessDays: merged.stalenessDays,
        defaultGradeBands: JSON.stringify(merged.defaultGradeBands),
        defaultFormula: merged.defaultFormula,
        defaultMinOkGrade: merged.defaultMinOkGrade,
        updatedAt: now,
      })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);

    return this.getById(id);
  }

  public reorderPinned(orderedIds: string[]): QualityDashboard[] {
    const now = new Date().toISOString();
    const trx = this.db.transaction(() => {
      for (let idx = 0; idx < orderedIds.length; idx++) {
        const compiled = this.k
          .updateTable('quality_dashboards')
          .set({ homeOrder: idx, updatedAt: now })
          .where('id', '=', orderedIds[idx])
          .where('isDefault', '=', 1)
          .compile();
        this.db.prepare(compiled.sql).run(...compiled.parameters);
      }
    });
    trx();
    return this.listPinned();
  }

  public deleteDashboard(id: string): boolean {
    const compiled = this.k.deleteFrom('quality_dashboards').where('id', '=', id).compile();
    const result = this.db.prepare(compiled.sql).run(...compiled.parameters);
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
      let newParent: string | null = null;
      if (n.parentNodeId) {
        const mapped = idRemap.get(n.parentNodeId);
        if (mapped === undefined) {
          throw new Error(`Unknown parentNodeId "${n.parentNodeId}" in tree payload`);
        }
        newParent = mapped;
      }
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
      const delCompiled = this.k
        .deleteFrom('quality_dashboard_nodes')
        .where('dashboardId', '=', dashboardId)
        .compile();
      this.db.prepare(delCompiled.sql).run(...delCompiled.parameters);
      for (const n of sorted) {
        const insCompiled = this.k.insertInto('quality_dashboard_nodes').values(n).compile();
        this.db.prepare(insCompiled.sql).run(...insCompiled.parameters);
      }
      const upCompiled = this.k
        .updateTable('quality_dashboards')
        .set({ updatedAt: new Date().toISOString() })
        .where('id', '=', dashboardId)
        .compile();
      this.db.prepare(upCompiled.sql).run(...upCompiled.parameters);
    });
    trx();

    return sorted.map(rowToNode);
  }

  public listAvailableProjects(): string[] {
    const compiled = this.k
      .selectFrom('reports')
      .select('project')
      .distinct()
      .where('project', 'is not', null)
      .orderBy('project')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      project: string;
    }>;
    return rows.map((r) => r.project).filter(Boolean);
  }

  public seedDefaultDashboard(): void {
    const compiled = this.k
      .selectFrom('quality_dashboards')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .compile();
    const existing = this.db.prepare(compiled.sql).get(...compiled.parameters) as { count: number };
    if (existing.count > 0) return;

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
  }
}

export const qualityDashboardsDb = singletonOf(
  'qualityDashboards',
  () => new QualityDashboardsDatabase()
);
