import type {
  Grade,
  GradeBands,
  GradeFormula,
  QualityDashboard,
  QualityNodeInput,
} from '@playwright-reports/shared';
import {
  computePassRate,
  DEFAULT_GRADE_BANDS,
  formatPassRate,
  gradeFor,
  isVerdictOk,
  normalizeStats,
  weightedAverage,
} from '@playwright-reports/shared';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderPlus,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { GradeBadge } from './grade-badge';
import { VerdictChip } from './snapshot-tree';

export interface EditorNode extends QualityNodeInput {
  id: string;
}

interface PreviewStats {
  passed: number;
  failed: number;
  flaky: number;
  total: number;
}

interface EditTreeProps {
  dashboard: QualityDashboard;
  nodes: EditorNode[];
  availableProjects: string[];
  projectStats: Record<string, PreviewStats | undefined>;
  selectedNodeId: string | null;
  onChange: (nodes: EditorNode[]) => void;
  onSelectNode: (id: string | null) => void;
}

interface Inheritance {
  bands: GradeBands;
  formula: GradeFormula;
  minOk: Grade;
}

interface PreviewSummary {
  passRate: number;
  grade: Grade;
  isOk: boolean;
}

function buildChildrenMap(nodes: EditorNode[]) {
  const map = new Map<string | null, EditorNode[]>();
  for (const node of nodes) {
    const list = map.get(node.parentNodeId ?? null) ?? [];
    list.push(node);
    map.set(node.parentNodeId ?? null, list);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return map;
}

function resolve(parent: Inheritance, node: EditorNode): Inheritance {
  return {
    bands: node.gradeBands ?? parent.bands,
    formula: node.formula ?? parent.formula,
    minOk: node.minOkGrade ?? parent.minOk,
  };
}

const EMPTY_PREVIEW: PreviewSummary = { passRate: 0, grade: 'F', isOk: false };

function computeAllPreviews(
  childrenMap: Map<string | null, EditorNode[]>,
  rootInheritance: Inheritance,
  projectStats: Record<string, PreviewStats | undefined>
): Map<string, PreviewSummary> {
  const previews = new Map<string, PreviewSummary>();

  const visit = (node: EditorNode, parent: Inheritance): PreviewSummary => {
    const resolved = resolve(parent, node);

    let summary: PreviewSummary;
    if (node.kind === 'project') {
      const stats = node.projectName ? projectStats[node.projectName] : undefined;
      if (!stats) {
        summary = EMPTY_PREVIEW;
      } else {
        const passRate = computePassRate(
          normalizeStats({ passed: stats.passed, failed: stats.failed, flaky: stats.flaky }),
          resolved.formula
        );
        const grade = gradeFor(passRate, resolved.bands);
        summary = { passRate, grade, isOk: isVerdictOk(grade, resolved.minOk) };
      }
    } else {
      const children = childrenMap.get(node.id) ?? [];
      const childSummaries = children.map((c) => ({ node: c, preview: visit(c, resolved) }));
      const passRate = weightedAverage(
        childSummaries.map((c) => ({ value: c.preview.passRate, weight: c.node.weight }))
      );
      const grade = gradeFor(passRate, resolved.bands);
      const isOk = childSummaries.every((c) => c.node.weight <= 0 || c.preview.isOk);
      summary = { passRate, grade, isOk };
    }

    previews.set(node.id, summary);
    return summary;
  };

  for (const root of childrenMap.get(null) ?? []) {
    visit(root, rootInheritance);
  }
  return previews;
}

export function newId(): string {
  return `local-${Math.random().toString(36).slice(2, 10)}`;
}

export function EditTree({
  dashboard,
  nodes,
  availableProjects,
  projectStats,
  selectedNodeId,
  onChange,
  onSelectNode,
}: EditTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rootInheritance: Inheritance = useMemo(
    () => ({
      bands: dashboard.defaultGradeBands ?? DEFAULT_GRADE_BANDS,
      formula: dashboard.defaultFormula,
      minOk: dashboard.defaultMinOkGrade,
    }),
    [dashboard]
  );

  const childrenMap = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const rootChildren = childrenMap.get(null) ?? [];

  const previews = useMemo(
    () => computeAllPreviews(childrenMap, rootInheritance, projectStats),
    [childrenMap, rootInheritance, projectStats]
  );

  const update = (next: EditorNode[]) => onChange(next);

  const addNode = (parentNodeId: string | null, kind: 'group' | 'project') => {
    const siblings = nodes.filter((n) => (n.parentNodeId ?? null) === parentNodeId);
    const sortOrder = siblings.length;
    const id = newId();
    const fresh: EditorNode =
      kind === 'group'
        ? {
            id,
            parentNodeId,
            kind: 'group',
            name: 'New group',
            weight: 1,
            sortOrder,
          }
        : {
            id,
            parentNodeId,
            kind: 'project',
            name: availableProjects[0] ?? 'project',
            projectName: availableProjects[0] ?? '',
            weight: 1,
            sortOrder,
          };
    update([...nodes, fresh]);
    onSelectNode(id);
  };

  const removeNode = (id: string) => {
    const toRemove = new Set<string>([id]);
    let added = true;
    while (added) {
      added = false;
      for (const n of nodes) {
        if (n.parentNodeId && toRemove.has(n.parentNodeId) && !toRemove.has(n.id)) {
          toRemove.add(n.id);
          added = true;
        }
      }
    }
    update(nodes.filter((n) => !toRemove.has(n.id)));
    if (selectedNodeId && toRemove.has(selectedNodeId)) onSelectNode(null);
  };

  const moveSibling = (id: string, direction: -1 | 1) => {
    const target = nodes.find((n) => n.id === id);
    if (!target) return;
    const siblings = (childrenMap.get(target.parentNodeId ?? null) ?? []).slice();
    const idx = siblings.findIndex((n) => n.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const aId = siblings[idx].id;
    const bId = siblings[swapIdx].id;
    const aOrder = siblings[idx].sortOrder;
    const bOrder = siblings[swapIdx].sortOrder;
    update(
      nodes.map((n) => {
        if (n.id === aId) return { ...n, sortOrder: bOrder };
        if (n.id === bId) return { ...n, sortOrder: aOrder };
        return n;
      })
    );
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Tree</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addNode(null, 'group')}>
            <FolderPlus className="h-4 w-4" /> Add group
          </Button>
          <Button size="sm" variant="outline" onClick={() => addNode(null, 'project')}>
            <Plus className="h-4 w-4" /> Add project
          </Button>
        </div>
      </div>

      {rootChildren.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No nodes yet. Add a project or group to get started.
        </p>
      ) : (
        <div className="space-y-2">
          {rootChildren.map((node) => (
            <EditNode
              key={node.id}
              node={node}
              depth={0}
              childrenMap={childrenMap}
              previews={previews}
              selectedNodeId={selectedNodeId}
              onSelect={onSelectNode}
              onAdd={addNode}
              onRemove={removeNode}
              onMove={moveSibling}
              collapsed={collapsed}
              onToggle={toggleCollapse}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface EditNodeProps {
  node: EditorNode;
  depth: number;
  childrenMap: Map<string | null, EditorNode[]>;
  previews: Map<string, PreviewSummary>;
  selectedNodeId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (parentNodeId: string | null, kind: 'group' | 'project') => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}

function EditNode({
  node,
  depth,
  childrenMap,
  previews,
  selectedNodeId,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  collapsed,
  onToggle,
}: EditNodeProps) {
  const isGroup = node.kind === 'group';
  const children = childrenMap.get(node.id) ?? [];
  const preview = previews.get(node.id) ?? EMPTY_PREVIEW;
  const isSelected = selectedNodeId === node.id;
  const isCollapsed = collapsed.has(node.id);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
          isSelected ? 'border-primary bg-accent' : 'bg-card',
          !isGroup && 'border-dashed'
        )}
        style={{ marginLeft: depth * 16 }}
      >
        {isGroup && children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : isGroup ? (
          <Folder className="h-4 w-4 text-muted-foreground" />
        ) : (
          <span className="inline-block w-6" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <GradeBadge grade={preview.grade} size="sm" />
          <span className="font-medium">{node.name}</span>
          {node.kind === 'project' && node.projectName && node.projectName !== node.name && (
            <span className="text-xs text-muted-foreground">({node.projectName})</span>
          )}
          <span className="text-xs text-muted-foreground">{formatPassRate(preview.passRate)}</span>
          <VerdictChip ok={preview.isOk} />
        </button>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onMove(node.id, -1)}
            aria-label="Move up"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onMove(node.id, 1)}
            aria-label="Move down"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          {isGroup && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onAdd(node.id, 'group')}
                aria-label="Add group inside"
                title="Add group inside"
              >
                <FolderPlus className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onAdd(node.id, 'project')}
                aria-label="Add project inside"
                title="Add project inside"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button size="icon" variant="ghost" onClick={() => onRemove(node.id)} aria-label="Remove">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      {isGroup && !isCollapsed && children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map((child) => (
            <EditNode
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenMap={childrenMap}
              previews={previews}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onAdd={onAdd}
              onRemove={onRemove}
              onMove={onMove}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface NodeConfigFormProps {
  dashboard: QualityDashboard;
  nodes: EditorNode[];
  selectedNodeId: string | null;
  availableProjects: string[];
  onChange: (nodes: EditorNode[]) => void;
}

export function NodeConfigForm({
  dashboard,
  nodes,
  selectedNodeId,
  availableProjects,
  onChange,
}: NodeConfigFormProps) {
  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        Select a node to edit its name, weight, formula, and thresholds.
      </div>
    );
  }

  const patch = (changes: Partial<EditorNode>) => {
    onChange(nodes.map((n) => (n.id === node.id ? { ...n, ...changes } : n)));
  };

  const inheritsBands = !node.gradeBands;
  const bands = node.gradeBands ?? dashboard.defaultGradeBands;
  const formula = node.formula ?? dashboard.defaultFormula;
  const minOk = node.minOkGrade ?? dashboard.defaultMinOkGrade;

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <Label htmlFor="node-name">Name</Label>
        <Input id="node-name" value={node.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>

      {node.kind === 'project' && (
        <div>
          <Label htmlFor="node-project">Playwright project</Label>
          <Select value={node.projectName ?? ''} onValueChange={(v) => patch({ projectName: v })}>
            <SelectTrigger id="node-project">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {availableProjects.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="node-weight">Weight (importance)</Label>
        <Input
          id="node-weight"
          type="number"
          min={0}
          step={0.5}
          value={node.weight}
          onChange={(e) => patch({ weight: Number(e.target.value) || 0 })}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Used when rolling up into the parent group. 0 excludes from the rollup.
        </p>
      </div>

      {node.kind === 'project' && (
        <div>
          <Label htmlFor="node-formula">Pass-rate formula</Label>
          <Select
            value={node.formula ?? '__inherit__'}
            onValueChange={(v) =>
              patch({ formula: v === '__inherit__' ? null : (v as GradeFormula) })
            }
          >
            <SelectTrigger id="node-formula">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">Inherit ({dashboard.defaultFormula})</SelectItem>
              <SelectItem value="lenient">Lenient (flakes count as pass)</SelectItem>
              <SelectItem value="strict">Strict (flakes count as fail)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="node-minOk">Min OK grade</Label>
        <Select
          value={node.minOkGrade ?? '__inherit__'}
          onValueChange={(v) => patch({ minOkGrade: v === '__inherit__' ? null : (v as Grade) })}
        >
          <SelectTrigger id="node-minOk">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">Inherit ({dashboard.defaultMinOkGrade})</SelectItem>
            {(['S', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => (
              <SelectItem key={g} value={g}>
                {g} or better
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label>Grade bands (% pass rate cutoffs)</Label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              patch({
                gradeBands: inheritsBands ? { ...dashboard.defaultGradeBands } : null,
              })
            }
          >
            {inheritsBands ? 'Override' : 'Reset to inherit'}
          </Button>
        </div>
        <div className={cn('mt-2 grid grid-cols-5 gap-2', inheritsBands && 'opacity-60')}>
          {(['S', 'A', 'B', 'C', 'D'] as const).map((g) => (
            <div key={g}>
              <Label htmlFor={`band-${g}`} className="text-xs">
                {g} ≥
              </Label>
              <Input
                id={`band-${g}`}
                type="number"
                min={0}
                max={100}
                step={0.1}
                disabled={inheritsBands}
                value={bands[g]}
                onChange={(e) =>
                  patch({
                    gradeBands: { ...bands, [g]: Number(e.target.value) || 0 },
                  })
                }
              />
            </div>
          ))}
        </div>
        {!inheritsBands && (
          <p className="mt-1 text-xs text-muted-foreground">
            Below {bands.D}% pass rate = F. Higher band must be ≥ lower band; the grader picks the
            highest matching band.
          </p>
        )}
      </div>

      <div className="rounded-md bg-muted/50 p-3 text-xs">
        <div className="font-medium">Resolved</div>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <div>
            <div className="text-muted-foreground">Formula</div>
            <div>{formula}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Min OK</div>
            <div>{minOk}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Bands</div>
            <div>
              S≥{bands.S} A≥{bands.A} B≥{bands.B} C≥{bands.C} D≥{bands.D}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
