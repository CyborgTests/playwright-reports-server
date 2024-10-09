'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { type Result } from '@/app/lib/storage';
import ResultsTable from '@/app/components/results-table';
import { title } from '@/app/components/primitives';
import GenerateReportButton from '@/app/components/generate-report-button';
import DeleteResultsButton from '@/app/components/delete-results-button';
import { getUniqueProjectsList } from '@/app/lib/storage/format';

interface ResultsProps {
  onChange: () => void;
}

export default function Results({ onChange }: ResultsProps) {
  const [selectedResults, setSelectedResults] = useState<Result[]>([]);
  const [refreshId, setRefreshId] = useState<string>(uuidv4());

  const selectedResultIds = selectedResults.map((r) => r.resultID);

  const projects = getUniqueProjectsList(selectedResults);

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
          <GenerateReportButton projects={projects} results={selectedResults} onGeneratedReport={onListUpdate} />
          <DeleteResultsButton resultIds={selectedResultIds} onDeletedResult={onDelete} />
        </div>
      </div>
      <br />
      <ResultsTable
        refreshId={refreshId}
        selected={selectedResultIds}
        onDeleted={onDelete}
        onSelect={setSelectedResults}
      />
    </>
  );
}
