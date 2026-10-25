import { useQuery } from '@tanstack/react-query';
import { GanttChart } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { authHeaders } from '@/lib/auth';
import { withBase } from '@/lib/url';
import { Button } from './ui/button';

const PERFETTO_ORIGIN = 'https://ui.perfetto.dev';
const PING_INTERVAL_MS = 50;
const HANDSHAKE_TIMEOUT_MS = 30_000;

const traceUrl = (reportId: string) => withBase(`/api/serve/${reportId}/perfetto.json.gz`);

// Hands the trace to Perfetto UI via postMessage so it needs no public URL or CORS.
// https://perfetto.dev/docs/visualization/deep-linking-to-perfetto-ui
const openInPerfetto = async (reportId: string, title: string) => {
  // Opened before the fetch so the popup blocker still sees the user gesture.
  const perfetto = window.open(PERFETTO_ORIGIN);
  if (!perfetto) throw new Error('Allow pop-ups to open the timeline');

  try {
    const response = await fetch(traceUrl(reportId), {
      headers: authHeaders(),
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Failed to load the timeline (${response.status})`);
    const buffer = await response.arrayBuffer();

    const ping = setInterval(() => perfetto.postMessage('PING', PERFETTO_ORIGIN), PING_INTERVAL_MS);
    const stop = () => {
      clearInterval(ping);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== PERFETTO_ORIGIN || event.data !== 'PONG') return;
      stop();
      perfetto.postMessage(
        { perfetto: { buffer, title, fileName: 'perfetto.json.gz' } },
        PERFETTO_ORIGIN
      );
    };
    window.addEventListener('message', onMessage);
    setTimeout(stop, HANDSHAKE_TIMEOUT_MS);
  } catch (error) {
    perfetto.close();
    throw error;
  }
};

interface TimelineButtonProps {
  reportId: string;
  title: string;
}

export const TimelineButton = ({ reportId, title }: TimelineButtonProps) => {
  // Reports generated before this feature, or with Playwright < 1.63, have no trace.
  const { data: hasTrace } = useQuery({
    queryKey: ['report-timeline', reportId],
    queryFn: async () => {
      const response = await fetch(traceUrl(reportId), {
        method: 'HEAD',
        headers: authHeaders(),
        credentials: 'include',
      });
      return response.ok;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!hasTrace) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      onClick={() => openInPerfetto(reportId, title).catch((e) => toast.error(errorMessage(e)))}
    >
      <GanttChart className="h-4 w-4" />
      Timeline
    </Button>
  );
};
