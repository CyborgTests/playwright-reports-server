'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import ResultsTable from '@/app/components/results-table';
import { title } from '@/app/components/primitives';
import GenerateReportButton from '@/app/components/generate-report-button';
import DeleteResultsButton from '@/app/components/delete-results-button';

interface ResultsProps {
  onChange: () => void;
}

export default function Results({ onChange }: ResultsProps) {
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [refreshId, setRefreshId] = useState<string>(uuidv4());

  const onListUpdate = () => {
    setSelectedResults([]);
    onChange?.();
  };

  const onDelete = () => {
    onListUpdate();
    setRefreshId(uuidv4());
  };

  return (
    <>
      <div className="flex w-full">
        <div className="w-1/3">
          <h1 className={title()}>Results</h1>
        </div>
        <div className="flex gap-2 w-2/3 flex-wrap justify-end mr-7">
          <GenerateReportButton resultIds={selectedResults} onGeneratedReport={onListUpdate} />
          <DeleteResultsButton resultIds={selectedResults} onDeletedResult={onDelete} />
        </div>
      </div>
      <br />
      <ResultsTable
        refreshId={refreshId}
        selected={selectedResults}
        onDeleted={onDelete}
        onSelect={setSelectedResults}
      />
    </>
  );
}
