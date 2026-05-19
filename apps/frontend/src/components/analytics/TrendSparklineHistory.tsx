import { ReportTestOutcomeEnum, type TestRun } from '@playwright-reports/shared';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const outcomeLabel = (outcome: string) => {
  if (outcome === ReportTestOutcomeEnum.Expected) return 'PASS';
  if (outcome === ReportTestOutcomeEnum.Flaky) return 'FLAKY';
  return 'FAIL';
};

const reportLabel = (run: TestRun): string => {
  const parts: string[] = [];
  if (typeof run.reportDisplayNumber === 'number') parts.push(`#${run.reportDisplayNumber}`);
  if (run.reportTitle) parts.push(run.reportTitle);
  return parts.join(' ');
};

const SparklineChart = ({ recentRuns }: { recentRuns: Array<TestRun> }) => {
  const maxRuns = Math.min(recentRuns.length, 30);
  const recentRunsSlice = recentRuns.slice(0, maxRuns).reverse();

  const colorPerOutcome: Record<string, string> = {
    [ReportTestOutcomeEnum.Expected]: 'bg-success',
    [ReportTestOutcomeEnum.Unexpected]: 'bg-danger',
    [ReportTestOutcomeEnum.Flaky]: 'bg-warning',
    default: 'bg-muted-foreground',
  };

  return (
    <TooltipProvider>
      <div className="flex items-end gap-px h-4">
        {recentRunsSlice.map((run) => {
          const isPassed = run.outcome === ReportTestOutcomeEnum.Expected;
          return (
            <Tooltip key={run.runId}>
              <TooltipTrigger asChild>
                <a href={`/report/${run.reportId}`}>
                  <div
                    className={`w-1 rounded-sm ${colorPerOutcome[run.outcome] || colorPerOutcome.default}`}
                    style={{ height: `${Math.max(2, (isPassed ? 0.8 : 1.0) * 16)}px` }}
                  />
                </a>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {outcomeLabel(run.outcome)}
                  {reportLabel(run) && <> &mdash; {reportLabel(run)}</>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(run.createdAt).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted-foreground">Click to open report</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {recentRunsSlice.length === 0 && <div className="text-xs text-gray-400">No data</div>}
      </div>
    </TooltipProvider>
  );
};

const getPassRateColor = (passRate: number) => {
  if (passRate >= 95) return 'text-success';
  if (passRate >= 70) return 'text-warning';
  return 'text-danger';
};

interface TrendSparklinesProps {
  runs: Array<TestRun>;
}

export function TrendSparklineHistory({ runs }: Readonly<TrendSparklinesProps>) {
  const totalMeaningfulRuns = runs.reduce(
    (sum, run) => sum + (run.outcome === ReportTestOutcomeEnum.Skipped ? 0 : 1),
    0
  );

  const totalPassed = runs.reduce(
    (sum, run) => sum + (run.outcome === ReportTestOutcomeEnum.Expected ? 1 : 0),
    0
  );
  const passRate = totalMeaningfulRuns > 0 ? (totalPassed / totalMeaningfulRuns) * 100 : 0;

  return (
    <div className="text-left">
      <div className="font-mono text-sm mb-1">
        <span className={getPassRateColor(passRate)}>{passRate.toFixed(2)}%</span>
      </div>
      <div className="flex items-center">
        <SparklineChart recentRuns={runs} />
      </div>
    </div>
  );
}
