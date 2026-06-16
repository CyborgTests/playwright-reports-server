import type { DiffOutcome, DiffTestEntry, DurationDeltaEntry } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { withBase } from '@/lib/url';

interface Props {
  entries: Array<DiffTestEntry | DurationDeltaEntry>;
  reportAUrl: string;
  reportBUrl: string;
  showDelta?: boolean;
}

const servedTestUrl = (reportUrl: string, testId: string): string =>
  `${withBase(reportUrl)}#?testId=${encodeURIComponent(testId)}`;

const outcomeVariant: Record<
  DiffOutcome,
  'success' | 'failure' | 'flaky' | 'skipped' | 'secondary'
> = {
  pass: 'success',
  fail: 'failure',
  flaky: 'flaky',
  skipped: 'skipped',
  unknown: 'secondary',
};

const outcomeLabel = (raw?: string, classified?: DiffOutcome): string => raw ?? classified ?? '—';

function OutcomeCell({
  outcome,
  raw,
  reportUrl,
  testId,
}: {
  outcome?: DiffOutcome;
  raw?: string;
  reportUrl: string;
  testId: string;
}) {
  if (!outcome) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <div className="inline-flex items-center gap-1.5">
      <Badge variant={outcomeVariant[outcome]}>{outcomeLabel(raw, outcome)}</Badge>
      <a
        href={servedTestUrl(reportUrl, testId)}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Open this test in the Playwright report"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

const isDurationEntry = (entry: DiffTestEntry | DurationDeltaEntry): entry is DurationDeltaEntry =>
  'deltaMs' in entry && typeof (entry as DurationDeltaEntry).deltaMs === 'number';

function DurationCell({ entry }: { entry: DiffTestEntry | DurationDeltaEntry }) {
  const { durationA, durationB } = entry;
  if (durationA === undefined && durationB === undefined) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <span className="text-xs font-mono whitespace-nowrap">
      {durationA !== undefined ? formatDuration(durationA) : '—'}
      <ArrowRight className="inline-block mx-1 h-3 w-3 text-muted-foreground" />
      {durationB !== undefined ? formatDuration(durationB) : '—'}
    </span>
  );
}

function DeltaCell({ entry }: { entry: DiffTestEntry | DurationDeltaEntry }) {
  if (!isDurationEntry(entry)) {
    if (entry.durationA !== undefined && entry.durationB !== undefined) {
      const deltaMs = entry.durationB - entry.durationA;
      return <DeltaDisplay deltaMs={deltaMs} deltaPct={deltaMs / Math.max(entry.durationA, 1)} />;
    }
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return <DeltaDisplay deltaMs={entry.deltaMs} deltaPct={entry.deltaPct} />;
}

function DeltaDisplay({ deltaMs, deltaPct }: { deltaMs: number; deltaPct: number }) {
  const isRegression = deltaMs > 0;
  const cls = isRegression ? 'text-failure' : 'text-success';
  const sign = isRegression ? '+' : '';
  return (
    <span className={`text-xs font-mono whitespace-nowrap ${cls}`}>
      {sign}
      {formatDuration(Math.abs(deltaMs))} ({sign}
      {(deltaPct * 100).toFixed(0)}%)
    </span>
  );
}

const titleTarget = (entry: DiffTestEntry, reportAUrl: string, reportBUrl: string): string => {
  const url = entry.outcomeB ? reportBUrl : reportAUrl;
  return servedTestUrl(url, entry.testId);
};

export function TestEntryTable({ entries, reportAUrl, reportBUrl, showDelta = false }: Props) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">Test</TableHead>
            <TableHead className="min-w-[140px]">File</TableHead>
            <TableHead className="min-w-[140px]">A · baseline</TableHead>
            <TableHead className="min-w-[140px]">B · target</TableHead>
            <TableHead className="min-w-[160px]">Duration</TableHead>
            {showDelta && <TableHead className="min-w-[100px]">Δ</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`${entry.testId}::${entry.fileId}::${entry.project}`}>
              <TableCell className="font-medium">
                <a
                  href={titleTarget(entry, reportAUrl, reportBUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline inline-flex items-center gap-1"
                >
                  {entry.title}
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[280px]">
                {entry.filePath}
              </TableCell>
              <TableCell>
                <OutcomeCell
                  outcome={entry.outcomeA}
                  raw={entry.rawOutcomeA}
                  reportUrl={reportAUrl}
                  testId={entry.testId}
                />
              </TableCell>
              <TableCell>
                <OutcomeCell
                  outcome={entry.outcomeB}
                  raw={entry.rawOutcomeB}
                  reportUrl={reportBUrl}
                  testId={entry.testId}
                />
              </TableCell>
              <TableCell>
                <DurationCell entry={entry} />
              </TableCell>
              {showDelta && (
                <TableCell>
                  <DeltaCell entry={entry} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
