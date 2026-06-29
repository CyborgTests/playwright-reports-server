import type { ClusterReport, DateRange, FailureCluster } from '@playwright-reports/shared';
import { RotateCcw, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import DateRangeSelect from '@/components/date-range-select';
import { ClusterCard } from '@/components/failure-clusters/cluster-card';
import { subtitle, title } from '@/components/primitives';
import ProjectSelect from '@/components/project-select';
import ReportPicker from '@/components/report-picker';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';
import { buildUrl } from '@/lib/url';

interface ClusterReportEnvelope {
  success: boolean;
  data: ClusterReport;
  error?: string;
}

export default function FailureClusters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(searchParams.get('project') ?? defaultProjectName);
  const [reportId, setReportId] = useState<string | undefined>(
    searchParams.get('reportId') ?? undefined
  );
  const [clusterId, setClusterId] = useState<string | undefined>(
    searchParams.get('clusterId') ?? undefined
  );
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }));
  const [includeResolved, setIncludeResolved] = useState(
    searchParams.get('includeResolved') === '1' || !!searchParams.get('clusterId')
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (project && project !== defaultProjectName) next.set('project', project);
    if (reportId) next.set('reportId', reportId);
    if (clusterId) next.set('clusterId', clusterId);
    if (dateRange.from) next.set('from', dateRange.from);
    if (dateRange.to) next.set('to', dateRange.to);
    if (includeResolved) next.set('includeResolved', '1');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [project, reportId, clusterId, dateRange, includeResolved, searchParams, setSearchParams]);

  const hasFilters =
    project !== defaultProjectName ||
    !!reportId ||
    !!clusterId ||
    !!dateRange.from ||
    !!dateRange.to ||
    includeResolved;

  const clearFilters = useCallback(() => {
    setProject(defaultProjectName);
    setReportId(undefined);
    setClusterId(undefined);
    setDateRange({ from: undefined, to: undefined });
    setIncludeResolved(false);
  }, []);

  const queryUrl = useMemo(() => {
    const params: Record<string, string> = {};
    if (project && project !== defaultProjectName) params.project = project;
    if (dateRange.from) params.from = dateRange.from;
    if (dateRange.to) params.to = dateRange.to;
    if (reportId) params.reportId = reportId;
    if (clusterId) params.clusterId = clusterId;
    if (includeResolved) params.includeResolved = '1';
    return buildUrl('/api/analytics/failure-clusters', params);
  }, [project, dateRange.from, dateRange.to, reportId, clusterId, includeResolved]);

  const { data, error, isLoading, isFetching, refetch } = useQuery<ClusterReportEnvelope>(
    queryUrl,
    {
      dependencies: [project, dateRange.from, dateRange.to, reportId, clusterId, includeResolved],
      select: (raw: unknown) => raw as ClusterReportEnvelope,
      staleTime: 20_000,
    }
  );

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const report = data?.data;
  const clusters = report?.clusters ?? [];

  return (
    <div className="w-full">
      <h1 className={`${title()} mb-2`}>Failure clusters</h1>
      <p className={`${subtitle()} mb-2`}>Failing tests grouped by likely shared cause.</p>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <ProjectSelect
            entity="report"
            selectedProject={project}
            onSelect={setProject}
            className="w-56"
          />
          <ReportPicker
            selectedReportId={reportId}
            onSelect={setReportId}
            defaultProject={project}
          />
          <DateRangeSelect selectedRange={dateRange} onSelect={setDateRange} disablePersistence />
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="include-resolved"
              checked={includeResolved}
              onCheckedChange={setIncludeResolved}
            />
            <Label htmlFor="include-resolved" className="text-sm cursor-pointer">
              Show resolved
            </Label>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="gap-1.5 pb-2" onClick={clearFilters}>
              <RotateCcw className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {clusterId && (
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <span>
            Filtered to cluster <code className="text-xs">{clusterId.slice(0, 12)}</code>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => setClusterId(undefined)}
          >
            Clear
          </Button>
        </div>
      )}

      {(isLoading || isFetching) && clusters.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : clusters.length === 0 ? (
        <EmptyState reportScoped={!!reportId} />
      ) : (
        <ClusterList
          clusters={clusters}
          reportId={reportId}
          deepLinkClusterId={clusterId}
          project={project}
          onChange={refetch}
        />
      )}
    </div>
  );
}

function EmptyState({ reportScoped }: { reportScoped: boolean }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <div className="text-lg">No failure clusters in this window</div>
        <div className="text-sm mt-2 max-w-md mx-auto">
          {reportScoped
            ? "None of this report's failed tests match an active cluster."
            : 'Adjust the project or date range to broaden the search.'}
        </div>
      </CardContent>
    </Card>
  );
}

function ClusterList({
  clusters,
  reportId,
  deepLinkClusterId,
  project,
  onChange,
}: {
  clusters: FailureCluster[];
  reportId?: string;
  deepLinkClusterId?: string;
  project: string;
  onChange: () => void;
}) {
  const actionable = clusters.filter((c) => c.anchor.kind !== 'unmatched');
  const unmatched = clusters.filter((c) => c.anchor.kind === 'unmatched');

  const [openActionable, setOpenActionable] = useState<string[]>(() =>
    deepLinkClusterId && actionable.some((c) => c.id === deepLinkClusterId)
      ? [deepLinkClusterId]
      : []
  );
  const [openUnmatched, setOpenUnmatched] = useState<string[]>(() =>
    deepLinkClusterId && unmatched.some((c) => c.id === deepLinkClusterId)
      ? [deepLinkClusterId]
      : []
  );

  useEffect(() => {
    if (!deepLinkClusterId) return;
    const el = document.getElementById(`cluster-${deepLinkClusterId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [deepLinkClusterId]);

  return (
    <div className="space-y-3">
      {actionable.length > 0 && (
        <Accordion
          type="multiple"
          className="space-y-3"
          value={openActionable}
          onValueChange={setOpenActionable}
        >
          {actionable.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              reportId={reportId}
              project={project}
              onChange={onChange}
            />
          ))}
        </Accordion>
      )}
      {unmatched.length > 0 && (
        <>
          <div className="text-xs uppercase tracking-wide text-muted-foreground pt-4 mb-2 px-1">
            Unmatched failures ({unmatched.length}) - no extractable mechanism
          </div>
          <Accordion
            type="multiple"
            className="space-y-3"
            value={openUnmatched}
            onValueChange={setOpenUnmatched}
          >
            {unmatched.map((cluster) => (
              <ClusterCard
                key={cluster.id}
                cluster={cluster}
                reportId={reportId}
                project={project}
                onChange={onChange}
              />
            ))}
          </Accordion>
        </>
      )}
    </div>
  );
}
