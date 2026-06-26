import { formatDuration, type TestWithQuarantineInfo } from '@playwright-reports/shared';
import { AlertTriangle, Clock, RotateCcw } from 'lucide-react';
import { forwardRef, memo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { TrendSparklineHistory } from '@/components/analytics/TrendSparklineHistory';
import FormattedDate from '@/components/date-format';
import { outcomeBadge } from '@/components/outcome-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDate } from '@/lib/date';
import { formatRegressionAge, getStatusBadge } from './badges';
import { exponentialMovingAverageDuration } from './calculations/ema';

interface TestRowProps {
  item: TestWithQuarantineInfo;
  warningThreshold: number;
  quarantineThreshold: number;
  stale: boolean;
  regressionHighlightMode: 'opened' | 'closed' | null;
  isResetFlakinessPending: boolean;
  isClearFlakinessResetPending: boolean;
  onQuarantine: (test: TestWithQuarantineInfo) => void;
  onResetFlakiness: (test: TestWithQuarantineInfo) => void;
  onClearFlakinessReset: (test: TestWithQuarantineInfo) => void;
  onDelete: (test: TestWithQuarantineInfo) => void;
}

export const TestRow = memo(
  forwardRef<HTMLTableRowElement, TestRowProps & { dataIndex: number }>(function TestRow(
    {
      item,
      warningThreshold,
      quarantineThreshold,
      stale,
      regressionHighlightMode,
      isResetFlakinessPending,
      isClearFlakinessResetPending,
      onQuarantine,
      onResetFlakiness,
      onClearFlakinessReset,
      onDelete,
      dataIndex,
    },
    ref
  ) {
    const highlights =
      regressionHighlightMode && item.regressionHighlights
        ? regressionHighlightMode === 'closed'
          ? { resolvedAtReportId: item.regressionHighlights.resolvedAtReportId }
          : { newAtReportId: item.regressionHighlights.newAtReportId }
        : undefined;

    return (
      <TableRow ref={ref} data-index={dataIndex}>
        <TableCell className="break-words">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <RouterLink
                to={`/test/${item.testId}?project=${encodeURIComponent(item.project)}`}
                className="font-medium break-words hover:underline"
              >
                {item.title}
              </RouterLink>
              {item.regression && (
                <Badge
                  variant="danger"
                  title={`Regression · opened ${formatDate(item.regression.regressedAt)} · ${item.regression.failureCount} failing run${item.regression.failureCount === 1 ? '' : 's'} since`}
                  className="gap-1 text-[10px] px-1.5 py-0"
                >
                  Regression · {formatRegressionAge(item.regression.daysOpen)}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground break-words">{item.filePath}</p>
          </div>
        </TableCell>
        <TableCell className="break-words">
          <p className="text-sm break-words">{item.project}</p>
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          {outcomeBadge(item.runs?.at(0)?.outcome)}
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          {getStatusBadge(item, warningThreshold, quarantineThreshold)}
        </TableCell>
        <TableCell className="whitespace-nowrap w-px relative">
          <div className="flex items-center gap-2">
            <Progress value={item.flakinessScore || 0} className="max-w-[100px] h-2" />
            <span className="text-sm">{item.flakinessScore?.toFixed(1)}%</span>
          </div>
          {item.flakinessResetAt && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <RotateCcw className="absolute top-7 right-0 h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  Flakiness reset on <FormattedDate date={item.flakinessResetAt} />
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          <Badge variant="outline">{item.totalRuns || 0}</Badge>
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          <TrendSparklineHistory runs={item.runs ?? []} highlights={highlights} />
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          <span className="flex items-center">
            <Clock className="h-4 w-4 mr-1" />
            {formatDuration(exponentialMovingAverageDuration(item.runs))}
          </span>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1 break-words">
            {item.lastRunAt ? <FormattedDate date={item.lastRunAt} /> : 'Never'}
            {stale && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <AlertTriangle className="h-4 w-4 text-warning" />
                  </TooltipTrigger>
                  <TooltipContent>Not present in latest report - consider removing</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </TableCell>

        <TableCell className="whitespace-nowrap w-px">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => onQuarantine(item)}
                className={item.isQuarantined ? 'text-success' : 'text-danger'}
              >
                {item.isQuarantined ? 'Remove Quarantine' : 'Send Quarantine'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onResetFlakiness(item)}
                disabled={isResetFlakinessPending}
              >
                Reset Flakiness Score
              </DropdownMenuItem>
              {item.flakinessResetAt && (
                <DropdownMenuItem
                  onClick={() => onClearFlakinessReset(item)}
                  disabled={isClearFlakinessResetPending}
                >
                  Remove Flakiness Reset
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDelete(item)} className="text-danger">
                Delete Test
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  })
);
