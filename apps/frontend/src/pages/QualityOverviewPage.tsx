import type {
  QualityDashboard,
  QualityDashboardSnapshot,
  QualityNodeInput,
  QualityNodeSnapshot,
} from '@playwright-reports/shared';
import { CAPABILITIES } from '@playwright-reports/shared';
import { Pencil, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CreateDashboardDialog } from '@/components/quality/create-dashboard-dialog';
import { DashboardMetaForm } from '@/components/quality/dashboard-meta-form';
import { DashboardSelector } from '@/components/quality/dashboard-selector';
import { type EditorNode, EditTree, NodeConfigForm } from '@/components/quality/edit-tree';
import { GradeBadge } from '@/components/quality/grade-badge';
import { HomeSummary } from '@/components/quality/home-summary';
import { PassRateBar } from '@/components/quality/pass-rate-bar';
import { PinnedDashboardCard } from '@/components/quality/pinned-dashboard-card';
import { SnapshotTree } from '@/components/quality/snapshot-tree';
import {
  CARD_BORDER_CLASS,
  dotForStatus,
  type PreviewStats,
  STATUS_LABEL,
  worstStatus,
} from '@/components/quality/status';
import { StatusBadge } from '@/components/quality/status-badge';
import { TrendArrow } from '@/components/quality/trend-arrow';
import MigrateLegacyData from '@/components/settings/components/MigrateLegacyData';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useHasCapability } from '@/hooks/useHasCapability';
import {
  type DashboardCreateInput,
  useCreateDashboard,
  useDeleteDashboard,
  useQualityDashboardConfig,
  useQualityDashboardList,
  useQualityDashboardSnapshot,
  useQualityHomeSnapshots,
  useQualityProjects,
  useReorderHome,
  useSaveDashboardTree,
  useUpdateDashboard,
} from '@/hooks/useQualityDashboards';
import { cn } from '@/lib/utils';

function flattenStats(
  node: QualityNodeSnapshot | undefined,
  acc: Record<string, PreviewStats> = {}
): Record<string, PreviewStats> {
  if (!node) return acc;
  if (node.kind === 'project' && node.projectName && node.stats) {
    acc[node.projectName] = {
      passed: node.stats.passed,
      failed: node.stats.failed,
      flaky: node.stats.flaky,
      total: node.stats.total,
    };
  }
  for (const child of node.children ?? []) flattenStats(child, acc);
  return acc;
}

export default function QualityOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSlug = searchParams.get('dashboard') ?? undefined;
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [showCreate, setShowCreate] = useState(false);
  const canManage = useHasCapability()(CAPABILITIES.manageQualityDashboards);

  const dashboardListQ = useQualityDashboardList();
  const dashboards = dashboardListQ.data ?? [];
  const showHome = !urlSlug;

  const activeSlug = useMemo(() => {
    if (urlSlug && dashboards.some((d) => d.slug === urlSlug)) return urlSlug;
    return undefined;
  }, [urlSlug, dashboards]);

  const setSlug = (slug: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (slug) next.set('dashboard', slug);
      else next.delete('dashboard');
      return next;
    });
  };

  const configQ = useQualityDashboardConfig(activeSlug);
  const snapshotQ = useQualityDashboardSnapshot(activeSlug);
  const homeQ = useQualityHomeSnapshots();
  const projectsQ = useQualityProjects();

  const createMutation = useCreateDashboard();
  const updateMutation = useUpdateDashboard();
  const deleteMutation = useDeleteDashboard();
  const saveTreeMutation = useSaveDashboardTree();

  const isLoading =
    dashboardListQ.isLoading ||
    (showHome && homeQ.isLoading) ||
    (!!activeSlug && (configQ.isLoading || snapshotQ.isLoading));

  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            {showHome
              ? 'Pinned dashboards'
              : 'Grade each project on its latest report; group projects to roll up a verdict.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!showHome && (
            <Button variant="ghost" size="sm" onClick={() => setSlug(undefined)}>
              ← Home
            </Button>
          )}
          <DashboardSelector
            dashboards={dashboards}
            currentSlug={activeSlug}
            onSelect={(slug) => {
              setMode('view');
              setSlug(slug);
            }}
            onCreate={canManage ? () => setShowCreate(true) : undefined}
          />
          {activeSlug && mode === 'view' && canManage && (
            <Button variant="outline" onClick={() => setMode('edit')}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {activeSlug && mode === 'edit' && (
            <Button variant="ghost" onClick={() => setMode('view')}>
              <X className="h-4 w-4" /> Done
            </Button>
          )}
        </div>
      </header>

      <MigrateLegacyData />

      {isLoading && (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      )}

      {!isLoading && dashboards.length === 0 && (
        <div className="rounded-md border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No dashboards yet.{canManage ? ' Create one to get started.' : ''}
          </p>
          {canManage && (
            <Button className="mt-4" onClick={() => setShowCreate(true)}>
              New dashboard
            </Button>
          )}
        </div>
      )}

      {!isLoading && showHome && dashboards.length > 0 && (
        <HomeView
          snapshots={homeQ.data ?? []}
          allDashboardsCount={dashboards.length}
          canManage={canManage}
          onEdit={(slug) => {
            setMode('edit');
            setSlug(slug);
          }}
        />
      )}

      {!isLoading && activeSlug && mode === 'view' && snapshotQ.data && (
        <SingleDashboardView snapshot={snapshotQ.data} />
      )}

      {!isLoading && activeSlug && mode === 'edit' && configQ.data && (
        <EditMode
          key={configQ.data.dashboard.id}
          dashboardId={configQ.data.dashboard.id}
          initialDashboard={configQ.data.dashboard}
          initialNodes={configQ.data.nodes.map((n) => ({
            id: n.id,
            parentNodeId: n.parentNodeId,
            kind: n.kind,
            name: n.name,
            projectName: n.projectName ?? null,
            weight: n.weight,
            sortOrder: n.sortOrder,
            gradeBands: n.gradeBands ?? null,
            formula: n.formula ?? null,
            minOkGrade: n.minOkGrade ?? null,
          }))}
          availableProjects={projectsQ.data ?? []}
          projectStats={flattenStats(snapshotQ.data?.root)}
          onSave={async (next, treeNodes) => {
            await updateMutation.mutateAsync({
              path: `/api/quality/dashboards/${next.id}`,
              body: {
                name: next.name,
                stalenessDays: next.stalenessDays,
                isDefault: next.isDefault,
                defaultFormula: next.defaultFormula,
                defaultMinOkGrade: next.defaultMinOkGrade,
                defaultGradeBands: next.defaultGradeBands,
              },
            });
            await saveTreeMutation.mutateAsync({
              path: `/api/quality/dashboards/${next.id}/tree`,
              body: { nodes: treeNodes },
            });
            setMode('view');
          }}
          onDelete={async () => {
            if (!window.confirm(`Delete dashboard "${configQ.data.dashboard.name}"?`)) return;
            await deleteMutation.mutateAsync({
              path: `/api/quality/dashboards/${configQ.data.dashboard.id}`,
            });
            setSlug(undefined);
            setMode('view');
          }}
        />
      )}

      <CreateDashboardDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={async (input: DashboardCreateInput) => {
          const created = (await createMutation.mutateAsync({ body: input })).data;
          if (!created) return;
          if (!created.isDefault) {
            setSlug(created.slug);
          }
          setMode('view');
          toast.success(`Created "${created.name}"`);
        }}
      />
    </div>
  );
}

interface HomeViewProps {
  snapshots: QualityDashboardSnapshot[];
  allDashboardsCount: number;
  canManage: boolean;
  onEdit: (slug: string) => void;
}

function HomeView({ snapshots, allDashboardsCount, canManage, onEdit }: HomeViewProps) {
  const reorderMutation = useReorderHome();

  const move = (idx: number, direction: -1 | 1) => {
    const swap = idx + direction;
    if (swap < 0 || swap >= snapshots.length) return;
    const ids = snapshots.map((s) => s.dashboard.id);
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    reorderMutation.mutate({ body: { orderedIds: ids } });
  };

  if (snapshots.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>No dashboards are pinned to the home page yet.</p>
        <p className="mt-1">
          {allDashboardsCount > 0
            ? 'Open a dashboard from the selector above and toggle "Show on home page" in Edit mode.'
            : 'Create one to get started.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HomeSummary snapshots={snapshots} />
      {snapshots.map((snapshot, idx) => (
        <PinnedDashboardCard
          key={snapshot.dashboard.id}
          snapshot={snapshot}
          onEdit={canManage ? () => onEdit(snapshot.dashboard.slug) : undefined}
          onMoveUp={canManage && idx > 0 ? () => move(idx, -1) : undefined}
          onMoveDown={canManage && idx < snapshots.length - 1 ? () => move(idx, 1) : undefined}
        />
      ))}
    </div>
  );
}

function SingleDashboardView({
  snapshot,
}: {
  snapshot: { dashboard: QualityDashboard; root: QualityNodeSnapshot };
}) {
  const { root } = snapshot;
  const status = worstStatus(root);
  const childCount = root.children?.length ?? 0;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-4 rounded-md border border-l-4 bg-card p-6 shadow-sm',
          CARD_BORDER_CLASS[status]
        )}
      >
        {root.empty ? (
          <span
            className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-muted text-lg font-bold text-muted-foreground ring-1 ring-muted-foreground/20"
            title="No data - add projects or upload reports."
          >
            -
          </span>
        ) : (
          <GradeBadge
            grade={root.grade}
            size="lg"
            dot={dotForStatus(status)}
            statusLabel={STATUS_LABEL[status]}
          />
        )}
        <div className="flex-1">
          <div className="text-sm uppercase tracking-wide text-muted-foreground">
            {root.empty ? 'No data' : 'Overall verdict'}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-2xl font-semibold">{root.name}</div>
            {status === 'notOk' && !root.empty && <StatusBadge status="notOk" />}
          </div>
          {root.empty ? (
            <p className="text-sm text-muted-foreground">
              Add projects in Edit mode, or upload reports to grade.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <PassRateBar
                passRate={root.passRate}
                bands={root.bandsUsed}
                minOkGrade={root.minOkGrade}
                className="min-w-[14rem] max-w-[24rem] flex-1"
              />
              <TrendArrow
                trend={root.trend}
                currentPassRate={root.passRate}
                previousPassRate={root.previousPassRate}
              />
              <span className="text-sm text-muted-foreground">
                {childCount} top-level node{childCount === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </div>

      <SnapshotTree root={root} />
    </div>
  );
}

interface EditModeProps {
  dashboardId: string;
  initialDashboard: QualityDashboard;
  initialNodes: EditorNode[];
  availableProjects: string[];
  projectStats: Record<string, PreviewStats>;
  onSave: (dashboard: QualityDashboard, nodes: QualityNodeInput[]) => Promise<void>;
  onDelete: () => Promise<void>;
}

function EditMode({
  initialDashboard,
  initialNodes,
  availableProjects,
  projectStats,
  onSave,
  onDelete,
}: EditModeProps) {
  const [dashboard, setDashboard] = useState<QualityDashboard>(initialDashboard);
  const [nodes, setNodes] = useState<EditorNode[]>(initialNodes);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const treeNodes: QualityNodeInput[] = nodes.map((n) => ({
        id: n.id,
        parentNodeId: n.parentNodeId,
        kind: n.kind,
        name: n.name,
        projectName: n.kind === 'project' ? (n.projectName ?? null) : null,
        weight: n.weight,
        sortOrder: n.sortOrder,
        gradeBands: n.gradeBands ?? null,
        formula: n.kind === 'project' ? (n.formula ?? null) : null,
        minOkGrade: n.minOkGrade ?? null,
      }));
      const missing = nodes.find((n) => n.kind === 'project' && !n.projectName);
      if (missing) {
        toast.error(`Project node "${missing.name}" needs a project selected`);
        setSaving(false);
        return;
      }
      await onSave(dashboard, treeNodes);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <DashboardMetaForm dashboard={dashboard} onChange={setDashboard} onDelete={onDelete} />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <EditTree
          dashboard={dashboard}
          nodes={nodes}
          availableProjects={availableProjects}
          projectStats={projectStats}
          selectedNodeId={selectedNodeId}
          onChange={setNodes}
          onSelectNode={setSelectedNodeId}
        />
        <NodeConfigForm
          dashboard={dashboard}
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          availableProjects={availableProjects}
          onChange={setNodes}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save dashboard'}
        </Button>
      </div>
    </div>
  );
}
