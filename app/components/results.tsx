'use client';

import { useState } from 'react';

import { type Result } from '@/app/lib/storage';
import ResultsTable from '@/app/components/results-table';
import { title } from '@/app/components/primitives';
import GenerateReportButton from '@/app/components/generate-report-button';
import DeleteResultsButton from '@/app/components/delete-results-button';
import { getUniqueProjectsList } from '@/app/lib/storage/format';

interface ResultsProps {
  onChange: () => void;
}

export default function Results({ onChange }: Readonly<ResultsProps>) {
  const [selectedResults, setSelectedResults] = useState<Result[]>([]);

  const selectedResultIds = selectedResults.map((r) => r.resultID);

  const projects = getUniqueProjectsList(selectedResults);

  const onListUpdate = () => {
    setSelectedResults([]);
    onChange?.();
  };

  return (
    <>
      <div className="flex w-full">
        <div className="w-1/3">
          <h1 className={title()}>Results</h1>
        </div>
        <div className="flex gap-2 w-2/3 flex-wrap justify-end items-center mr-7">
          {selectedResults.length > 0 && (
            <div className="text-sm pr-3 text-primary">Results selected: {selectedResults.length}</div>
          )}
          <GenerateReportButton projects={projects} results={selectedResults} onGeneratedReport={onListUpdate} />
          <DeleteResultsButton label="Delete" resultIds={selectedResultIds} onDeletedResult={onListUpdate} />
        </div>
      </div>
      <br />
      <ResultsTable selected={selectedResultIds} onDeleted={onListUpdate} onSelect={setSelectedResults} />
    </>
  );
}
