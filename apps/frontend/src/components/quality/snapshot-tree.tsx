import type { QualityNodeSnapshot } from '@playwright-reports/shared';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { GradeBadge } from './grade-badge';
import { PassRateBar } from './pass-rate-bar';
import { StatusBadge } from './status-badge';
import { TrendArrow } from './trend-arrow';

interface SnapshotTreeProps {
  root: QualityNodeSnapshot;
}

export function SnapshotTree({ root }: SnapshotTreeProps) {
  const children = root.children ?? [];
  if (children.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This dashboard is empty. Switch to Edit mode to add projects.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {children.map((child) => (
        <SnapshotNode key={child.nodeId} node={child} depth={0} />
      ))}
    </div>
  );
}

interface SnapshotNodeProps {
  node: QualityNodeSnapshot;
  depth: number;
}

function SnapshotNode({ node, depth }: SnapshotNodeProps) {
  const [open, setOpen] = useState(true);
  const isGroup = node.kind === 'group';
  const hasChildren = !!(node.children && node.children.length > 0);
  const indent = depth * 16;
  const status = statusFor(node);

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2.5 rounded-md border bg-card px-3 py-2',
          isGroup ? 'shadow-sm' : 'border-dashed'
        )}
        style={{ marginLeft: indent }}
      >
        {isGroup && hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="-ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            aria-label={open ? 'Collapse group' : 'Expand group'}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : isGroup ? (
          <Folder className="ml-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <span className="inline-block w-6" />
        )}
        <GradeBadge
          grade={node.grade}
          size={isGroup ? 'md' : 'sm'}
          dot={dotForRow(status)}
          statusLabel={
            status === 'stale'
              ? `Stale — ${staleDetail(node) ?? 'latest report past staleness threshold'}`
              : statusLabelFor(status)
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn('truncate', isGroup ? 'text-sm font-semibold' : 'text-sm font-medium')}
            >
              {node.name}
            </span>
            {node.kind === 'project' && node.projectName && node.projectName !== node.name && (
              <span className="truncate text-xs text-muted-foreground">({node.projectName})</span>
            )}
            {status === 'noReports' && <StatusBadge status="noReports" />}
            {status === 'notOk' && (
              <StatusBadge
                status="notOk"
                detail={`Grade ${node.grade}, min required ${node.minOkGrade}.`}
              />
            )}
          </div>
          {!node.empty && (
            <div className="mt-1 flex items-center gap-3">
              <PassRateBar
                passRate={node.passRate}
                bands={node.bandsUsed}
                minOkGrade={node.minOkGrade}
                size={isGroup ? 'md' : 'sm'}
                className="max-w-[24rem] flex-1"
              />
              <TrendArrow
                trend={node.trend}
                currentPassRate={node.passRate}
                previousPassRate={node.previousPassRate}
              />
            </div>
          )}
        </div>
        {node.kind === 'project' && node.latestReportId && (
          <Link
            to={`/report/${node.latestReportId}`}
            className="text-xs font-medium text-primary opacity-0 transition-opacity underline-offset-2 hover:underline group-hover:opacity-100"
          >
            Latest report →
          </Link>
        )}
      </div>
      {isGroup && hasChildren && open && (
        <div className="mt-1.5 space-y-1.5">
          {(node.children ?? []).map((child) => (
            <SnapshotNode key={child.nodeId} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

type NodeStatus = 'ok' | 'stale' | 'notOk' | 'noReports' | 'empty';

function statusFor(node: QualityNodeSnapshot): NodeStatus {
  if (node.kind === 'project' && node.hasReports === false) return 'noReports';
  if (node.empty) return 'empty';
  if (!node.isOk) return 'notOk';
  if (node.kind === 'project' && node.stale) return 'stale';
  return 'ok';
}

function statusLabelFor(status: NodeStatus): string | undefined {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'stale':
      return 'Stale';
    case 'notOk':
      return 'Not OK';
    case 'noReports':
      return 'No reports yet';
    default:
      return undefined;
  }
}

function dotForRow(status: NodeStatus): 'ok' | 'warn' | undefined {
  if (status === 'ok') return 'ok';
  if (status === 'stale') return 'warn';
  return undefined;
}

function staleDetail(node: QualityNodeSnapshot): string | undefined {
  if (!node.latestReportAt) return undefined;
  const ts = Date.parse(node.latestReportAt);
  if (!Number.isFinite(ts)) return undefined;
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  return days <= 0 ? undefined : `${days} day${days === 1 ? '' : 's'} old.`;
}

export function VerdictChip({ ok }: { ok: boolean }) {
  return (
    <Badge variant={ok ? 'success' : 'failure'} className="uppercase">
      {ok ? 'OK' : 'Not OK'}
    </Badge>
  );
}
