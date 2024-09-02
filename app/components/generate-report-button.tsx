'use client';
import { Tooltip, Button } from '@nextui-org/react';
import { useRouter } from 'next/navigation';

interface DeleteProjectButtonProps {
  resultIds: string[];
  onGenerated?: (ids: string[]) => void;
  token: string;
}

export default function GenerateReportButton({ resultIds, token, onGenerated }: DeleteProjectButtonProps) {
  const router = useRouter();

  const GenerateReport = async () => {
    if (!resultIds?.length) {
      return;
    }

    const headers = !!token
      ? {
          Authorization: token,
        }
      : undefined;

    await fetch('/api/report/generate', {
      method: 'POST',
      body: JSON.stringify({ resultsIds: resultIds }),
      headers,
    });

    router.refresh();
    onGenerated?.([]);
  };

  return (
    <Tooltip color="secondary" content="Generate Report" placement="top">
      <Button color="secondary" isDisabled={!resultIds?.length} size="md" onClick={GenerateReport}>
        Generate Report
      </Button>
    </Tooltip>
  );
}
