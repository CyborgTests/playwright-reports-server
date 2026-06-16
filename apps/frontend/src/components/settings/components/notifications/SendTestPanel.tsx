import type { NotificationRule } from '@playwright-reports/shared';
import { CheckCircle2, Loader2, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authHeaders } from '@/lib/auth';
import { withBase } from '@/lib/url';
import { ReportSearchInput } from './ReportSearchInput';

interface SendTestPanelProps {
  channelId: string;
  draft: NotificationRule;
}

interface TestOutcome {
  ok: boolean;
  httpStatus?: number;
  error?: string;
  attempts: number;
  skipReason?: string;
}

export function SendTestPanel({ channelId, draft }: Readonly<SendTestPanelProps>) {
  const [reportId, setReportId] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | undefined>(undefined);

  const requiresReport = draft.kind === 'event';
  const canSend = !sending && (!requiresReport || !!reportId);

  const run = async () => {
    setSending(true);
    setOutcome(undefined);
    try {
      const res = await fetch(withBase('/api/notifications/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ channelId, rule: draft, reportId: reportId || undefined }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        const err = body.error || `HTTP ${res.status}`;
        setOutcome({ ok: false, attempts: 0, error: err });
        toast.error(`Test failed: ${err}`);
        return;
      }
      const first: TestOutcome | undefined = body.data?.results?.[0]?.result;
      setOutcome(first);
      if (first?.ok) {
        toast.success('Test message sent');
      } else if (first?.skipReason) {
        toast.warning(`Skipped (${first.skipReason})`);
      } else {
        toast.error(`Test failed: ${first?.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOutcome({ ok: false, attempts: 0, error: msg });
      toast.error(`Test failed: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Send test
      </h4>
      <p className="text-[11px] text-muted-foreground">
        Fires this rule against{' '}
        {requiresReport ? 'the selected report' : 'a synthesized last-24h window'} using the current
        form state. Logged with the{' '}
        <span className="inline-flex items-center rounded bg-secondary text-secondary-foreground px-1 py-0.5 text-[10px] font-medium">
          test
        </span>{' '}
        source.
      </p>
      <ReportSearchInput
        value={reportId}
        onChange={setReportId}
        placeholder={requiresReport ? 'Pick a report…' : 'Optional — pick a report'}
      />
      <div className="flex items-center gap-2 pt-1">
        <Button type="button" size="sm" onClick={run} disabled={!canSend}>
          {sending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5 mr-1" />
              Send test
            </>
          )}
        </Button>
        {outcome && <TestOutcomeBadge outcome={outcome} />}
      </div>
      {outcome?.error && (
        <p className="text-[11px] text-danger break-words pt-1">{outcome.error}</p>
      )}
      {outcome?.skipReason && !outcome.error && (
        <p className="text-[11px] text-muted-foreground pt-1">Skipped: {outcome.skipReason}</p>
      )}
    </div>
  );
}

function TestOutcomeBadge({ outcome }: Readonly<{ outcome: TestOutcome }>) {
  if (outcome.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> Sent
        {outcome.httpStatus !== undefined && (
          <span className="text-muted-foreground"> · HTTP {outcome.httpStatus}</span>
        )}
        {outcome.attempts > 1 && (
          <span className="text-muted-foreground"> · {outcome.attempts} attempts</span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-danger">
      <XCircle className="h-3.5 w-3.5" />
      {outcome.skipReason ? 'Skipped' : 'Failed'}
      {outcome.httpStatus !== undefined && (
        <span className="text-muted-foreground"> · HTTP {outcome.httpStatus}</span>
      )}
    </span>
  );
}
