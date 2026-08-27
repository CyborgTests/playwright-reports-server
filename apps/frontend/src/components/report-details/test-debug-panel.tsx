import { CLEANUP_RULES, type ReportTestFailure } from '@playwright-reports/shared';
import { ArrowUpRight, Film, Image as ImageIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import FormattedDate from '@/components/date-format';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import useQuery from '@/hooks/useQuery';
import { withBase } from '@/lib/url';
import { StatsBadges } from './suite-tree';

interface FailureResponse {
  data: ReportTestFailure | null;
}

function CrossProject({
  rows,
  testId,
}: {
  rows: ReportTestFailure['crossProject'];
  testId: string;
}) {
  return (
    <div className="rounded-md border p-3 space-y-1.5 text-xs">
      <p className="font-medium">
        Also runs in {rows.length} other {rows.length === 1 ? 'project' : 'projects'}
      </p>
      {rows.map((row) => (
        <div key={row.project} className="space-y-0.5 border-t pt-1.5 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <RouterLink
              to={`/test/${testId}?project=${encodeURIComponent(row.project)}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {row.project}
            </RouterLink>
            {row.isQuarantined && <Badge variant="destructive">Quarantined</Badge>}
            {row.lastRunAt && (
              <span className="text-muted-foreground">
                last <FormattedDate date={row.lastRunAt} mode="date" />
              </span>
            )}
          </div>
          <StatsBadges stats={row.stats} noun="run" />
        </div>
      ))}
    </div>
  );
}

function FailureHistory({ history }: { history: ReportTestFailure['history'] }) {
  const { priorOccurrenceCount, firstOccurrence, distinctErrors, totalFailures, previousFailure } =
    history;

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {priorOccurrenceCount !== null && (
          <Badge variant={priorOccurrenceCount === 0 ? 'secondary' : 'warning'}>
            {priorOccurrenceCount === 0 ? 'First time' : `Seen ${priorOccurrenceCount}x before`}
          </Badge>
        )}
        {previousFailure && previousFailure.sameError !== null && (
          <span className="text-muted-foreground">
            {previousFailure.sameError
              ? 'Same error as the previous failure'
              : 'Different error from the previous failure'}
          </span>
        )}
      </div>

      {firstOccurrence && (
        <p className="text-muted-foreground">
          First found in{' '}
          <RouterLink
            to={`/report/${firstOccurrence.reportId}`}
            className="text-primary hover:underline"
          >
            {firstOccurrence.displayNumber ? `#${firstOccurrence.displayNumber} ` : ''}
            {firstOccurrence.title ?? 'report'}
          </RouterLink>{' '}
          · <FormattedDate date={firstOccurrence.createdAt} />
        </p>
      )}

      {totalFailures > 0 && (
        <p className="text-muted-foreground">
          This test has failed {totalFailures}x with {distinctErrors} distinct{' '}
          {distinctErrors === 1 ? 'error' : 'errors'}.
        </p>
      )}
    </div>
  );
}

interface AnalysisResponse {
  data: { analysis?: string; model?: string } | null;
  pending?: { taskId: string; status: string } | null;
}

interface TestDebugPanelProps {
  reportId: string;
  testId: string;
  project?: string;
}

const TestDebugPanel: FC<TestDebugPanelProps> = ({ reportId, testId, project }) => {
  const {
    data: failure,
    isLoading: failureLoading,
    error: failureError,
  } = useQuery<FailureResponse>(`/api/report/${reportId}/test/${testId}/failure`, { retry: false });
  const { data: analysis } = useQuery<AnalysisResponse>(
    `/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(reportId)}`,
    { refetchInterval: (query) => (query.state.data?.pending ? 5000 : false) }
  );

  const details = failure?.data ?? null;
  const screenshot = details?.attachments.find((attachment) =>
    attachment.contentType.startsWith('image/')
  );
  const video = details?.attachments.find((attachment) =>
    attachment.contentType.startsWith('video/')
  );
  const analysisText = analysis?.data?.analysis;

  const trace = details?.attachments.find((attachment) => attachment.name === 'trace');
  const traceViewerUrl =
    trace && details?.traceViewerBase
      ? `${withBase(details.traceViewerBase)}?trace=${encodeURIComponent(new URL(withBase(trace.url), window.location.href).toString())}`
      : null;
  const removedLabels = (details?.removedAttachmentKinds ?? [])
    .map((kind) => CLEANUP_RULES[kind].label.toLowerCase())
    .join(', ');

  const tabs: string[] = [];
  if (details) tabs.push('error');
  if (
    details &&
    (screenshot ||
      video ||
      traceViewerUrl ||
      removedLabels.length > 0 ||
      !details.artifactsAvailable)
  ) {
    tabs.push('media');
  }
  if (analysisText || analysis?.pending) tabs.push('analysis');

  const [tab, setTab] = useState<string | undefined>();
  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0];

  if (failureLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    );
  }
  if (failureError) {
    return (
      <p className="text-sm text-muted-foreground">Could not load failure details for this run.</p>
    );
  }
  if (tabs.length === 0) return null;

  return (
    <Tabs value={activeTab} onValueChange={setTab} className="w-full">
      <TabsList>
        {tabs.includes('error') && <TabsTrigger value="error">Error</TabsTrigger>}
        {tabs.includes('media') && <TabsTrigger value="media">Media</TabsTrigger>}
        {tabs.includes('analysis') && <TabsTrigger value="analysis">LLM</TabsTrigger>}
      </TabsList>

      <TabsContent value="error" className="mt-3 space-y-2">
        {details?.location && (
          <p className="text-xs text-muted-foreground">
            {details.location.file}
            {details.location.line != null ? `:${details.location.line}` : ''}
          </p>
        )}
        {details?.message && (
          <pre className="max-h-[24rem] overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words">
            {details.message}
            {details.stackTrace ? `\n\n${details.stackTrace}` : ''}
          </pre>
        )}
        {details?.history && <FailureHistory history={details.history} />}
        {details?.crossProject && details.crossProject.length > 0 && (
          <CrossProject rows={details.crossProject} testId={testId} />
        )}
      </TabsContent>

      <TabsContent value="media" className="mt-3 space-y-3">
        {details && !details.artifactsAvailable && (
          <p className="text-sm text-muted-foreground">
            The stored report for this run has been removed, so its screenshot, video and trace are
            no longer available.
          </p>
        )}
        {details?.artifactsAvailable && removedLabels.length > 0 && (
          <p className="text-sm text-muted-foreground">Removed {removedLabels} for this run.</p>
        )}
        {details?.artifactsAvailable && removedLabels.length === 0 && !screenshot && !video && (
          <p className="text-sm text-muted-foreground">No screenshot or video for this run.</p>
        )}
        {screenshot && (
          <a href={withBase(screenshot.url)} target="_blank" rel="noreferrer" className="block">
            <img
              src={withBase(screenshot.url)}
              alt="Failure screenshot"
              loading="lazy"
              className="w-full rounded-md border"
            />
          </a>
        )}
        {video && (
          <video
            src={withBase(video.url)}
            controls
            preload="none"
            className="w-full rounded-md border"
          >
            <track kind="captions" />
          </video>
        )}
        <div className="flex flex-wrap gap-3 text-sm">
          {traceViewerUrl && (
            <a
              href={traceViewerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open trace viewer
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
          {screenshot && (
            <a
              href={withBase(screenshot.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Screenshot
            </a>
          )}
          {video && (
            <a
              href={withBase(video.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Film className="h-3.5 w-3.5" />
              Video
            </a>
          )}
        </div>
      </TabsContent>

      <TabsContent value="analysis" className="mt-3">
        {analysisText ? (
          <div className="space-y-2">
            {analysis?.data?.model && (
              <p className="text-xs text-muted-foreground">{analysis.data.model}</p>
            )}
            <div className="max-h-[28rem] overflow-y-auto pr-1 text-sm">
              <MarkdownRenderer content={analysisText} fallbackProject={project} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            Analysis {analysis?.pending?.status === 'running' ? 'running' : 'queued'}…
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};

export default TestDebugPanel;
