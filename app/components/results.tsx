'use client';

import { useState } from 'react';

import ResultsTable from '@/app/components/results-table';
import { title } from '@/app/components/primitives';
import GenerateReportButton from '@/app/components/generate-report-button';
import DeleteResultsButton from '@/app/components/delete-results-button';

interface ResultsProps {
  onChange: () => void;
}

export default function Results({ onChange }: ResultsProps) {
  const [selectedResults, setSelectedResults] = useState<string[]>([]);

  const onGeneratedReport = () => {
    setSelectedResults([]);
    onChange?.();
  };

  return (
    <>
      <div className="flex w-full">
        <div className="w-2/3">
          <h1 className={title()}>Results</h1>
        </div>
        <div className="flex gap-2 w-1/3 justify-end mr-7">
          <GenerateReportButton resultIds={selectedResults} onGeneratedReport={onGeneratedReport} />
          <DeleteResultsButton resultIds={selectedResults} onDeletedResult={onChange} />
        </div>
      </div>
      <br />
      <ResultsTable selected={selectedResults} onDeleted={onChange} onSelect={setSelectedResults} />
    </>
  );
}
