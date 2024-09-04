'use client';

import { Tooltip, Button } from '@nextui-org/react';

import useMutation from '@/app/hooks/useMutation';
import ErrorMessage from '@/app/components/error-message';

interface DeleteProjectButtonProps {
  resultIds?: string[];
  onGeneratedReport?: () => void;
}

export default function GenerateReportButton({ resultIds, onGeneratedReport }: DeleteProjectButtonProps) {
  const { mutate: generateReport, isLoading, error } = useMutation('/api/report/generate', { method: 'POST' });

  const GenerateReport = async () => {
    if (!resultIds?.length) {
      return;
    }

    await generateReport({ resultsIds: resultIds });

    onGeneratedReport?.();
  };

  return (
    <>
      {error && <ErrorMessage message={error.message} />}
      <Tooltip color="secondary" content="Generate Report" placement="top">
        <Button
          color="secondary"
          isDisabled={!resultIds?.length}
          isLoading={isLoading}
          size="md"
          onClick={GenerateReport}
        >
          Generate Report
        </Button>
      </Tooltip>
    </>
  );
}
