import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { withBase } from '@/lib/url';

interface ServedReportLinkProps {
  reportUrl: string | null;
}

export const ServedReportLink = ({ reportUrl }: ServedReportLinkProps) => {
  const button = (
    <Button size="sm" className="gap-2" disabled={!reportUrl}>
      <ExternalLink className="h-4 w-4" />
      Open report
    </Button>
  );

  if (reportUrl) {
    return (
      <Link to={withBase(reportUrl)} target="_blank">
        {button}
      </Link>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent>Report files deleted - stats only</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
